# Copyright (c) Facebook, Inc. and its affiliates.
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.
#%%
import argparse
import time
import os, sys
import os.path as osp
from shutil import copy
import copy as cp
from tqdm import tqdm
import pdb
import json

import multiprocessing


import numpy as np
import networkx as nx
from sklearn.metrics import roc_auc_score
import scipy.sparse as ssp
from scipy.sparse.csgraph import shortest_path
import torch
from torch.nn import BCEWithLogitsLoss, Embedding
from torch.utils.data import DataLoader
from torch.utils.data import random_split
from torch.utils.data import Subset

from torch_sparse import coalesce
import torch_geometric.transforms as T
from torch_geometric.datasets import Planetoid
from torch_geometric.data import Data, Dataset, InMemoryDataset, DataLoader
from torch_geometric.utils import to_networkx, to_undirected
from torch_geometric.loader import NeighborSampler, NeighborLoader

from ogb.linkproppred import PygLinkPropPredDataset, Evaluator
from scipy import sparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from sklearn.metrics import precision_recall_curve

from queue import Queue
import threading
from collections import Counter
from sklearn.metrics import roc_curve, auc
import matplotlib.pyplot as plt
from sklearn.metrics import precision_score, recall_score, f1_score


import warnings
warnings.filterwarnings("ignore", category=UserWarning)

from scipy.sparse import SparseEfficiencyWarning
warnings.simplefilter('ignore', SparseEfficiencyWarning)

from DL_model_utils import *
from DL_model_models import *
from DL_model_custom_dataset import *
import pickle
import h5py
import pickle

os.environ['CUDA_LAUNCH_BLOCKING'] = '1'
torch.backends.cudnn.benchmark = True

import warnings

# 忽略特定警告信息
warnings.filterwarnings("ignore", message="An output with one or more elements was resized")
warnings.filterwarnings("ignore", category=UserWarning, module="torch_geometric")

#%%


class SEALDataset(InMemoryDataset):
    def __init__(self, root, data, split_edge, num_hops, percent=100, split='train', 
                use_coalesce=False, node_label='drnl', ratio_per_hop=1.0, 
                max_nodes_per_hop=None, directed=False,
                ):
        self.data = data
        self.split_edge = split_edge
        self.num_hops = num_hops
        self.percent = int(percent) if percent >= 1.0 else percent
        self.split = split
        self.use_coalesce = use_coalesce
        self.node_label = node_label
        self.ratio_per_hop = ratio_per_hop
        self.max_nodes_per_hop = max_nodes_per_hop
        self.directed = directed
        super(SEALDataset, self).__init__(root)
        self.data, self.slices = torch.load(self.processed_paths[0])


    @property
    def processed_file_names(self):
        if self.percent == 100:
            name = 'SEAL_{}_data'.format(self.split)
        else:
            name = 'SEAL_{}_data_{}'.format(self.split, self.percent)
        name += '.pt'
        return [name]


    def process(self):
        pos_edge, neg_edge = get_pos_neg_edges(self.split, self.split_edge, 
                                            self.data.edge_index, 
                                            self.data.num_nodes, 
                                            self.percent)

        print("Number of positive edges: ", pos_edge.size(1)) # [2, x]
        print("Number of negative edges: ", neg_edge.size(1)) # [2, x]

        if self.use_coalesce:  # compress mutli-edge into edge with weight
            self.data.edge_index, self.data.edge_weight = coalesce(
                self.data.edge_index, self.data.edge_weight, 
                self.data.num_nodes, self.data.num_nodes)

        if 'edge_weight' in self.data:
            edge_weight = self.data.edge_weight.view(-1)
        else:
            edge_weight = torch.ones(self.data.edge_index.size(1), dtype=int)
        A = ssp.csr_matrix(
            (edge_weight, (self.data.edge_index[0], self.data.edge_index[1])), 
            shape=(self.data.num_nodes, self.data.num_nodes)
        )

        if self.directed:
            A_csc = A.tocsc()
        else:
            A_csc = None
        
        # Extract enclosing subgraphs for pos and neg edges
        pos_list = extract_enclosing_subgraphs(
            pos_edge, A, self.data.x, 1, self.num_hops, self.node_label, 
            self.ratio_per_hop, self.max_nodes_per_hop, self.directed, A_csc)
        neg_list = extract_enclosing_subgraphs(
            neg_edge, A, self.data.x, 0, self.num_hops, self.node_label, 
            self.ratio_per_hop, self.max_nodes_per_hop, self.directed, A_csc)


        print("pos_list length: ", len(pos_list))
        print("neg_list length: ", len(neg_list))


        # Additional code to find max node_id
        max_node_id = self.data.edge_index.max().item()
        print(f'Maximum node ID in {self.split} split:', max_node_id)


        torch.save(self.collate(pos_list + neg_list), self.processed_paths[0])
        del pos_list, neg_list



class SEALDynamicDataset(Dataset):

    def __init__(self, root, data, split_edge, num_hops, percent=100, split='train', 
                use_coalesce=False, node_label='drnl', ratio_per_hop=1.0, 
                max_nodes_per_hop=None, directed=False, 
                force_recompute=False, split_type='train', **kwargs):

        self.data = data
        self.split_edge = split_edge
        self.num_hops = num_hops
        self.percent = percent
        self.use_coalesce = use_coalesce
        self.node_label = node_label
        self.ratio_per_hop = ratio_per_hop
        self.max_nodes_per_hop = max_nodes_per_hop
        self.directed = directed

        # 设置 TEMP 文件夹路径，根据 split_type 确定存储路径
        # self.cache_dir = os.path.join(os.getcwd(), "TEMP", split_type)
        self.cache_dir = os.path.join('/media/luoht/新加卷/luoht/seal_ppi/', "TEMP", split_type)

        os.makedirs(self.cache_dir, exist_ok=True)

        self.json_index_path = os.path.join(self.cache_dir, "index.json")
        self.split_type = split_type
        self.records_per_file = 80000  # 每个 HDF5 文件存储 8 万条记录


        super(SEALDynamicDataset, self).__init__(root)


        # 如果强制重新生成缓存，则删除现有缓存文件
        if force_recompute:
            print(f"Removing existing cache files and index in {self.cache_dir}")
            for file in os.listdir(self.cache_dir):
                if file.startswith(self.split_type):
                    os.remove(os.path.join(self.cache_dir, file))

        # 获取正负样本边
        pos_edge, neg_edge = get_pos_neg_edges(split, self.split_edge, 
                                               self.data.edge_index, 
                                               self.data.num_nodes, 
                                               self.percent,
                                               pos_neg_ratio = 1/1 )
        self.links = torch.cat([pos_edge, neg_edge], 1).t().tolist()
        self.labels = [1] * pos_edge.size(1) + [0] * neg_edge.size(1)



        label_counter = Counter(self.labels)
        print(f"Label distribution: {label_counter}")


        # 压缩多重边到边权重
        if self.use_coalesce:
            self.data.edge_index, self.data.edge_weight = coalesce(
                self.data.edge_index, self.data.edge_weight, 
                self.data.num_nodes, self.data.num_nodes
            )

        # 初始化邻接矩阵
        if 'edge_weight' in self.data:
            edge_weight = self.data.edge_weight.view(-1)
        else:
            edge_weight = torch.ones(self.data.edge_index.size(1), dtype=int)
        self.A = ssp.csr_matrix(
            (edge_weight, (self.data.edge_index[0], self.data.edge_index[1])), 
            shape=(self.data.num_nodes, self.data.num_nodes)
        )
        self.A_csc = self.A.tocsc() if self.directed else None

        # 添加稀疏性检查
        self._check_sparsity()

        # # 如果缓存文件和索引不存在，预计算子图并存储
        # # if not os.path.exists(self.json_index_path):
        # self._precompute_and_store()

        # # 加载 JSON 索引
        # with open(self.json_index_path, "r") as f:
        #     self.index = json.load(f)




    def _check_sparsity(self):
        """
        检查图的稀疏性并输出相关信息。
        """
        total_elements = self.A.shape[0] * self.A.shape[1]
        nonzero_count = self.A.nnz  # 非零元素数量
        sparsity = 1 - (nonzero_count / total_elements)

        print(f"Graph Sparsity: {sparsity:.2%}")
        print(f"Graph is {'Sparse' if sparsity > 0.9 else 'Dense'}")
        print(f"Non-zero elements: {nonzero_count}, Total elements: {total_elements}")


    def _compute_k_hop_sparse(self, src, dst):
        """
        使用稀疏矩阵计算 k-hop 子图。
        """
        # 初始集合：src 和 dst 节点
        init_nodes = {src, dst}
        mask = np.zeros(self.A.shape[0], dtype=bool)  # 初始化节点掩码
        mask[list(init_nodes)] = True

        # 使用稀疏矩阵的幂次计算 k-hop 邻域
        adjacency_power = self.A
        for _ in range(self.num_hops):
            new_mask = adjacency_power.dot(mask)  # 获取新一层邻域
            mask = np.logical_or(mask, new_mask)  # 合并到当前邻域

        subgraph_nodes = np.where(mask)[0]  # 获取 k-hop 子图节点索引
        subgraph = self.A[subgraph_nodes, :][:, subgraph_nodes]  # 提取子图稀疏矩阵

        # # 检查全局索引是否正确
        # if src not in subgraph_nodes or dst not in subgraph_nodes:
        #     raise ValueError(f"src ({src}) or dst ({dst}) not in subgraph_nodes.")

        # 计算节点标签 z
        z = self._drnl_node_labeling(subgraph_nodes, src, dst)

        return subgraph, subgraph_nodes, z

    def _drnl_node_labeling(self, subgraph_nodes, src, dst):
        try:
            # 提取子图的稀疏矩阵
            subgraph_sparse = self.A[subgraph_nodes, :][:, subgraph_nodes]

            # 计算 src 和 dst 到其他节点的最短路径长度
            src_idx = subgraph_nodes.tolist().index(src)
            dst_idx = subgraph_nodes.tolist().index(dst)

            distances_src = shortest_path(subgraph_sparse, directed=False, unweighted=True, indices=src_idx)
            distances_dst = shortest_path(subgraph_sparse, directed=False, unweighted=True, indices=dst_idx)

            # 初始化节点标签数组 z
            z = 1 + np.minimum(distances_src, distances_dst).astype(int)

            # 确保 src 和 dst 的标签为 1
            z[src_idx] = 1
            z[dst_idx] = 1

            return z
        except Exception as e:
            print(f"Error in node labeling: {e}")
            return np.zeros(len(subgraph_nodes), dtype=np.int64)
        
    def _get_last_cached_index(self):
        """
        查找最后缓存的索引，确保断点续写。
        """
        # 如果索引文件不存在，则说明从未开始缓存
        if not os.path.exists(self.json_index_path):
            return -1

        # 读取现有索引文件，找到最大的索引值
        with open(self.json_index_path, "r") as f:
            index = json.load(f)
            if index:
                return max(map(int, index.keys()))
            else:
                return -1

    def _precompute_and_store(self):
        """
        逐个计算子图并存储到 HDF5 文件中，从断点续写。
        """
        print(f"Precomputing and storing subgraphs for {self.split_type}...")
        last_cached_idx = self._get_last_cached_index()
        print(f"Last cached index found: {last_cached_idx}")

        # Start from the next index
        start_idx = last_cached_idx + 1

        file_idx = start_idx // self.records_per_file
        record_idx = start_idx % self.records_per_file
        index = {}

        # 如果存在已经存储的数据，读取现有的索引文件
        if last_cached_idx >= 0:
            with open(self.json_index_path, "r") as f:
                index = json.load(f)

        # 准备打开文件
        current_file_path = os.path.join(self.cache_dir, f"{self.split_type}_subgraphs_{file_idx}.h5")

        # 初始化 h5f 为 None，准备在后续打开
        h5f = None

        try:
            # 继续存储未完成的部分
            for idx in tqdm(range(start_idx, len(self.links)), desc=f"Caching {self.split_type} subgraphs", ncols=80):
                # 当记录索引达到最大数量时，关闭当前文件并准备打开一个新文件
                if record_idx % self.records_per_file == 0 and idx != start_idx:
                    if h5f:  # 确保只有在 h5f 不为 None 时关闭文件
                        h5f.close()

                    # 更新文件索引，准备打开新文件
                    file_idx += 1
                    record_idx = 0  # 新文件记录从头开始
                    current_file_path = os.path.join(self.cache_dir, f"{self.split_type}_subgraphs_{file_idx}.h5")
                    h5f = h5py.File(current_file_path, "a")  # 追加模式

                # 确保在开始循环时文件是打开的
                if h5f is None:
                    h5f = h5py.File(current_file_path, "a")

                try:
                    # 计算子图
                    src, dst = self.links[idx]
                    y = self.labels[idx]
                    subgraph, subgraph_nodes, z = self._compute_k_hop_sparse(src, dst)

                    if len(subgraph_nodes) == 0:
                        print(f"Skipping empty subgraph {idx} with src={src}, dst={dst}")
                        continue

                    # 提取特征和全局边索引
                    x = self.data.x[subgraph_nodes].numpy().astype(np.float32)
                    rows, cols = subgraph.nonzero()
                    edge_index = np.array([rows, cols], dtype=np.int32)
                    z = z.astype(np.int16)

                    # 存储子图
                    h5f.create_dataset(f"subgraph_{record_idx}_x", data=x, compression='lzf')
                    h5f.create_dataset(f"subgraph_{record_idx}_edge_index", data=edge_index, compression='lzf')
                    h5f.create_dataset(f"subgraph_{record_idx}_y", data=[y], compression='lzf')
                    h5f.create_dataset(f"subgraph_{record_idx}_node_id", data=subgraph_nodes, compression='lzf')
                    h5f.create_dataset(f"subgraph_{record_idx}_z", data=z, compression='lzf')

                    # 更新索引
                    index[idx] = {
                        "file": os.path.basename(current_file_path),
                        "record": record_idx
                    }
                    record_idx += 1

                except Exception as e:
                    print(f"Error caching subgraph {idx}: {type(e).__name__} - {e}")
                    continue

        finally:
            # 确保在最后关闭打开的文件
            if h5f:
                h5f.close()

        # 保存索引文件
        with open(self.json_index_path, "w") as f:
            json.dump(index, f)

    def __len__(self):
        return len(self.links)

    def len(self):
        return self.__len__()


    def get(self, idx):
        """
        直接计算子图，而不是从 HDF5 读取。
        """
        if idx >= len(self.links):
            raise IndexError(f"索引 {idx} 超出范围，最大索引: {len(self.links) - 1}")

        # 直接计算子图
        src, dst = self.links[idx]
        y = self.labels[idx]

        # if idx<5:
        #     self.check_idxs(idx)

        subgraph, subgraph_nodes, z = self._compute_k_hop_sparse(src, dst)

        if len(subgraph_nodes) == 0:
            raise ValueError(f"Empty subgraph at index {idx} with src={src}, dst={dst}")

        # 提取特征和全局边索引
        x = self.data.x[subgraph_nodes]
        rows, cols = subgraph.nonzero()
        edge_index = torch.tensor([rows, cols], dtype=torch.long)

        z = torch.tensor(z, dtype=torch.long)

        return Data(x=x, edge_index=edge_index, target_edge=torch.tensor([[src], [dst]]).t(),y=torch.tensor([y], dtype=torch.long), node_id=torch.tensor(subgraph_nodes, dtype=torch.long), z=z)

    def check_idxs(self,idx):
        src, dst = self.links[idx]
        y = self.labels[idx]
        subgraph, subgraph_nodes, z = self._compute_k_hop_sparse(src, dst)
        print('idx', idx)
        print('src, dst', src, dst)







    # def get(self, idx):
    #     """
    #     根据索引加载子图数据。
    #     """
    #     # 从索引中读取文件名和记录位置
    #     if str(idx) not in self.index:
    #         raise ValueError(f"Index {idx} not found in cache. Ensure data is precomputed properly.")

    #     record = self.index[str(idx)]
    #     file_name = record["file"]
    #     record_idx = record["record"]

    #     # 确保读取路径和写入路径一致
    #     file_path = os.path.join(self.cache_dir, file_name)

    #     # 从相应的 HDF5 文件读取子图数据
    #     with h5py.File(file_path, "r") as h5f:
    #         try:
    #             x = torch.tensor(h5f[f"subgraph_{record_idx}_x"][()], dtype=torch.float)
    #             edge_index = torch.tensor(h5f[f"subgraph_{record_idx}_edge_index"][()], dtype=torch.long)
    #             y = torch.tensor(h5f[f"subgraph_{record_idx}_y"][()], dtype=torch.long)
    #             node_id = torch.tensor(h5f[f"subgraph_{record_idx}_node_id"][()], dtype=torch.long)
    #             z = torch.tensor(h5f[f"subgraph_{record_idx}_z"][()], dtype=torch.long)

    #             return Data(x=x, edge_index=edge_index, y=y, node_id=node_id, z=z)
    #         except KeyError as e:
    #             raise ValueError(f"Record {record_idx} not found in {file_name}: {e}")



    def _check_label_distribution(self, labels):
        """
        统计标签的分布。
        """
        if not hasattr(self, 'label_counter'):
            self.label_counter = Counter()

        self.label_counter.update(labels)
        print(f"Current label distribution: {self.label_counter}")




class SEALDynamicDataset_finetune(SEALDynamicDataset):

    def __init__(self, root, data, data_graph, split_edge, split_edge_graph, num_hops, percent=100, split='train', 
                use_coalesce=False, node_label='drnl', ratio_per_hop=1.0, 
                max_nodes_per_hop=None, directed=False, 
                force_recompute=False, split_type='train', **kwargs):


        super(SEALDynamicDataset_finetune, self).__init__(
            root=root,
            data=data,
            split_edge=split_edge,  # 父类需要的参数（即使后续会覆盖）
            num_hops=num_hops,
            split=split,           # 显式传递 split
        )

        # ✅ 覆盖父类的关键参数
        self.data = data
        self.data_graph = data_graph
        self.split_edge = split_edge
        self.split_edge_graph = split_edge_graph
        self.num_hops = num_hops
        self.percent = percent
        self.use_coalesce = use_coalesce
        self.node_label = node_label
        self.ratio_per_hop = ratio_per_hop
        self.max_nodes_per_hop = max_nodes_per_hop
        self.directed = directed


        # 设置 TEMP 文件夹路径，根据 split_type 确定存储路径
        # self.cache_dir = os.path.join(os.getcwd(), "TEMP", split_type)
        # self.cache_dir = os.path.join('/media/weimin/8T_31/Angdi/', "TEMP", split_type)
        self.cache_dir = os.path.join('/media/luoht/新加卷/luoht/seal_ppi/TEMP_finetune', split_type)
        os.makedirs(self.cache_dir, exist_ok=True)

        self.json_index_path = os.path.join(self.cache_dir, "index.json")
        self.split_type = split_type
        self.records_per_file = 80000  # 每个 HDF5 文件存储 8 万条记录




        # ✅ **关键修改：当 split='all' 时，直接使用 pred_data 的边**
        if split == 'all':
            # 直接使用 split_edge_graph['all']['edge'] 作为预测边
            pred_edges = self.split_edge['all']['edge']
            self.links = pred_edges.t().tolist()  # 转换为 (src, dst) 列表


            self.labels = [1] * pred_edges.size(1)  # 假设所有预测边标签为1（可根据需求调整）
        else:
            # 原有逻辑：训练/验证/测试阶段使用正负边
            pos_edge, neg_edge = get_pos_neg_edges(split, self.split_edge, 
                                                 self.data.edge_index, 
                                                 self.data.num_nodes, 
                                                 self.percent,
                                                 pos_neg_ratio = 1/1 )
            self.links = torch.cat([pos_edge, neg_edge], 1).t().tolist()
            self.labels = [1] * pos_edge.size(1) + [0] * neg_edge.size(1)

        print(f"[Fine-tune {split}] Label distribution: {Counter(self.labels)}")

        # ✅ **Train 阶段：使用 `data_graph` 作为 `self.A`**
        if split == "train" or split == "all" :
            if 'edge_weight' in self.data_graph:
                edge_weight = self.data_graph.edge_weight.view(-1)
            else:
                edge_weight = torch.ones(self.split_edge_graph[split]['edge'].size(1), dtype=int)

            self.A = ssp.csr_matrix(
                (edge_weight, (self.split_edge_graph[split]['edge'][0], self.split_edge_graph[split]['edge'][1])), 
                shape=(self.data_graph.num_nodes, self.data_graph.num_nodes)
            )
            self.A_csc = self.A.tocsc() if self.directed else None

        else:
            if 'edge_weight' in self.data:
                edge_weight = self.data.edge_weight.view(-1)
            else:
                edge_weight = torch.ones(self.split_edge[split]['edge'].size(1), dtype=int)

            self.A = ssp.csr_matrix(
                (edge_weight, (self.split_edge[split]['edge'][0], self.split_edge[split]['edge'][1])), 
                shape=(self.data.num_nodes, self.data.num_nodes)
            )
            self.A_csc = self.A.tocsc() if self.directed else None

        # print(f"Final links source: {'split_edge_graph' if split=='all' else 'split_edge'}")
        # print(f"First 5 links:", self.links[:5])


        label_counter = Counter(self.labels)
        print(f"Label distribution: {label_counter}")


        # 添加稀疏性检查
        self._check_sparsity()

        # # 如果缓存文件和索引不存在，预计算子图并存储
        # # if not os.path.exists(self.json_index_path):
        # self._precompute_and_store()

        # # 加载 JSON 索引
        # with open(self.json_index_path, "r") as f:
            # self.index = json.load(f)



  





def train0(model, optimizer, train_dataset, train_loader, device, args, emb=None):
    model.train()
    total_loss = 0

    # # 计算整个数据集的最大节点ID，同时处理空的edge_index情况
    # max_node_id_dataset = 0
    # for data in train_dataset:
    #     if data.edge_index.size(1) > 0:  # 检查edge_index是否为空
    #         max_node_id_dataset = max(max_node_id_dataset, data.edge_index.max().item())

    # # 输出数据集中的最大节点ID
    # print(f"Maximum node ID in the dataset: {max_node_id_dataset}")


    # # 打印 edge_index 的前几个连接，看是否合理
    # print('check edge', data.edge_index[:, :10])


    # 如果使用了嵌入，检查嵌入矩阵的大小
    if emb is not None:
        print("Embedding matrix size:", emb.weight.size())




    pbar = tqdm(train_loader, ncols=70)
    # max_node_id_loader = 0  # 初始化最大节点ID跟踪器
    for data in pbar:
        data = data.to(device)

        # # 检查是否存在空的 edge_index
        # if data.edge_index.numel() == 0:
        #     print("Warning: Skipping batch with empty edge_index.")
        #     continue  # 跳过这个批次


        # # 假设 num_nodes 是节点的总数，这个应该是你网络中的最大节点索引 + 1
        # num_nodes = data.x.size(0)
        # # 检查 edge_index 中的最大索引是否超出了节点数
        # if data.edge_index.max().item() >= num_nodes:
        #     print(f"Error: edge_index contains node indices out of bounds. Max node ID: {data.edge_index.max().item()}, while num_nodes is {num_nodes}")
        # else:
        #     print("Edge index is valid.")

        # # 检查节点特征矩阵大小
        # print("Number of nodes from feature matrix:", data.x.size(0))


        optimizer.zero_grad()
        x = data.x if args.use_feature else None
        edge_weight = data.edge_weight if args.use_edge_weight else None
        node_id = data.node_id if emb is not None else None

        # # 打印关键参数和数据状态
        # current_max_id = data.edge_index.max().item()
        # max_node_id_loader = max(max_node_id_loader, current_max_id)
        # print(f"Batch size: {data.num_graphs}")
        # print(f"Max node ID in this batch: {current_max_id}")
        # print(f"Edge index sample: {data.edge_index[:, :5]}")

        # if x is not None:
        #     print(f"Feature matrix sample: {x[:5, :5]}")
        # if edge_weight is not None:
        #     print(f"Edge weights sample: {edge_weight[:5]}")
        # if emb is not None:
        #     print(f"Embedding size: {emb.weight.size()}")

        # if node_id is not None:
        #     print(f"Node IDs sample: {node_id[:5]}")
        #     print(f"Maximum Node ID: {node_id.max().item()}")
        #     if node_id.max().item() >= emb.weight.size(0):
        #         print(f"Error: Maximum node ID {node_id.max().item()} exceeds embedding size {emb.weight.size(0)}.")


        # 确认 edge_index 不为空，并且最大索引在有效范围内
        if data.edge_index.numel() == 0:
            # print("Warning: Skipping batch with empty edge_index.")
            continue  # 跳过这个批次


        try:
            logits = model(data.z, data.edge_index, data.batch, x, edge_weight, node_id)
            loss = BCEWithLogitsLoss()(logits.view(-1), data.y.to(torch.float))
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * data.num_graphs
        except Exception as e:
            print(f"Error during training: {str(e)}")
            break  # Stop training if there is an error

    return total_loss / len(train_dataset)



def train(model, optimizer, train_dataset,  train_loader, device, args, emb=None):

    model.train()

    y_pred, y_true = [], []  # 用于计算 train 评估指标

    total_loss = 0

    pbar = tqdm(train_loader, ncols=70)
    for data in pbar:
        data = data.to(device)
        optimizer.zero_grad()
        x = data.x if args.use_feature else None
        edge_weight = data.edge_weight if args.use_edge_weight else None
        node_id = data.node_id if emb else None



        logits = model(data.z, data.edge_index, data.batch, x, edge_weight, node_id)
        loss = BCEWithLogitsLoss()(logits.view(-1), data.y.to(torch.float))
        loss.backward()
        optimizer.step()
        total_loss += loss.item() * data.num_graphs


        # 记录 y_true 和 y_pred 以便计算 train AUC
        y_pred.append(logits.view(-1).detach().cpu())
        y_true.append(data.y.view(-1).cpu().to(torch.float))

    avg_loss = total_loss / len(train_dataset)


    # 转换为 NumPy 格式
    y_pred = torch.cat(y_pred).sigmoid()  # 变成概率
    y_true = torch.cat(y_true)

    # 打印 batch 内 y_true 的类别分布
    print("Train batch label distribution:", Counter(y_true.numpy()))


    # 计算各种评估指标（和 test 逻辑一致）
    results = {}
    for metric in args.eval_metrics:
        if metric == 'auc':
            results.update(evaluate_auc(y_pred, y_true, y_pred, y_true))
        elif metric == 'precision':
            results.update(evaluate_precision(y_pred, y_true, y_pred, y_true))
        elif metric == 'recall':
            results.update(evaluate_recall(y_pred, y_true, y_pred, y_true))
        elif metric == 'f1':
            results.update(evaluate_f1(y_pred, y_true, y_pred, y_true))

    print(f"Train Loss: {avg_loss:.4f}")
    for key, value in results.items():
        print(f"Train {key}: {value}")
    return avg_loss

'''
@torch.no_grad()
def test(model, val_loader, test_loader, device, args, emb, evaluator):
    model.eval()

    y_pred, y_true = [], []
    for data in tqdm(val_loader, ncols=70):
        data = data.to(device)
        x = data.x if args.use_feature else None
        edge_weight = data.edge_weight if args.use_edge_weight else None
        node_id = data.node_id if emb else None
        logits = model(data.z, data.edge_index, data.batch, x, edge_weight, node_id)
        y_pred.append(logits.view(-1).cpu())
        y_true.append(data.y.view(-1).cpu().to(torch.float))
    val_pred, val_true = torch.cat(y_pred), torch.cat(y_true)
    pos_val_pred = val_pred[val_true==1]
    neg_val_pred = val_pred[val_true==0]

    y_pred, y_true = [], []
    for data in tqdm(test_loader, ncols=70):
        data = data.to(device)
        x = data.x if args.use_feature else None
        edge_weight = data.edge_weight if args.use_edge_weight else None
        node_id = data.node_id if emb else None
        logits = model(data.z, data.edge_index, data.batch, x, edge_weight, node_id)
        y_pred.append(logits.view(-1).cpu())
        y_true.append(data.y.view(-1).cpu().to(torch.float))
    test_pred, test_true = torch.cat(y_pred), torch.cat(y_true)
    pos_test_pred = test_pred[test_true==1]
    neg_test_pred = test_pred[test_true==0]


    # print("Training set label distribution:", Counter(train_true))
    # print("Validation set label distribution:", Counter(val_true))

    results = {}

    for metric in args.eval_metrics:
        if metric == 'hits':
            results.update(evaluate_hits(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred, evaluator))
        elif metric == 'mrr':
            results.update(evaluate_mrr(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred, evaluator))
        elif metric == 'rocauc':
            results.update(evaluate_ogb_rocauc(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred, evaluator))
        elif metric == 'auc':
            results.update(evaluate_auc(val_pred, val_true, test_pred, test_true))
        elif metric == 'fdr':
            results.update(evaluate_fdr(val_pred, val_true, test_pred, test_true))

    return results
'''
@torch.no_grad()
def test(model, val_loader, test_loader, device, args, emb, evaluator):
    model.eval()

    y_pred, y_true = [], []
    for data in tqdm(val_loader, ncols=70):
        data = data.to(device)
        x = data.x if args.use_feature else None
        edge_weight = data.edge_weight if args.use_edge_weight else None
        node_id = data.node_id if emb else None
        logits = model(data.z, data.edge_index, data.batch, x, edge_weight, node_id)
        y_pred.append(logits.view(-1).cpu())
        y_true.append(data.y.view(-1).cpu().to(torch.float))
    val_pred, val_true = torch.cat(y_pred), torch.cat(y_true)
    pos_val_pred = val_pred[val_true==1]
    neg_val_pred = val_pred[val_true==0]

    y_pred, y_true = [], []
    for data in tqdm(test_loader, ncols=70):
        data = data.to(device)
        x = data.x if args.use_feature else None
        edge_weight = data.edge_weight if args.use_edge_weight else None
        node_id = data.node_id if emb else None
        logits = model(data.z, data.edge_index, data.batch, x, edge_weight, node_id)
        y_pred.append(logits.view(-1).cpu())
        y_true.append(data.y.view(-1).cpu().to(torch.float))
    test_pred, test_true = torch.cat(y_pred), torch.cat(y_true)
    pos_test_pred = test_pred[test_true==1]
    neg_test_pred = test_pred[test_true==0]

    # 绘制并保存 ROC 曲线
    plot_roc_curve(val_true.numpy(), val_pred.numpy(), save_path=f'evaluation_plots/val_roc_epoch_{args.epoch}_curve.png', title=f'Validation ROC epoch{args.epoch} Curve')
    plot_roc_curve(test_true.numpy(), test_pred.numpy(), save_path=f'evaluation_plots/test_roc_epoch_{args.epoch}_curve.png', title=f'Test ROC epoch{args.epoch} Curve')

    # 绘制 Precision-Recall 曲线
    plot_precision_recall_curve(val_true.numpy(), val_pred.numpy(), save_path=f'evaluation_plots/val_precision_recall_epoch_{args.epoch}.png', title=f'Validation Precision-Recall epoch{args.epoch} Curve')
    plot_precision_recall_curve(test_true.numpy(), test_pred.numpy(), save_path=f'evaluation_plots/test_precision_recall_epoch_{args.epoch}.png', title=f'Test Precision-Recall epoch{args.epoch} Curve')


    # 返回结果
    results = {}
    for metric in args.eval_metrics:
        if metric == 'hits':
            results.update(evaluate_hits(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred, evaluator))
        elif metric == 'mrr':
            results.update(evaluate_mrr(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred, evaluator))
        elif metric == 'rocauc':
            results.update(evaluate_rocauc(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred))
        elif metric == 'auc':
            results.update(evaluate_auc(val_pred, val_true, test_pred, test_true))
        elif metric == 'fdr':
            results.update(evaluate_fdr(val_pred, val_true, test_pred, test_true))
        elif metric == 'precision':
            results.update(evaluate_precision(val_pred, val_true, test_pred, test_true))
        elif metric == 'recall':
            results.update(evaluate_recall(val_pred, val_true, test_pred, test_true))
        elif metric == 'f1':
            results.update(evaluate_f1(val_pred, val_true, test_pred, test_true))

    return results

def plot_roc_curve(y_true, y_pred, save_path, title='ROC Curve'):
    """
    绘制并保存 ROC 曲线。
    
    参数:
    - y_true: 真实标签 (0 或 1) 的张量或数组。
    - y_pred: 预测得分的张量或数组。
    - save_path: 保存图像的路径。
    - title: 图像标题，默认为 'ROC Curve'。
    """
    fpr, tpr, _ = roc_curve(y_true, y_pred)  # 计算 FPR 和 TPR
    roc_auc = auc(fpr, tpr)  # 计算 AUC 值

    plt.figure(figsize=(8, 6))
    plt.plot(fpr, tpr, color='darkorange', lw=2, label=f'ROC curve (AUC = {roc_auc:.2f})')
    plt.plot([0, 1], [0, 1], color='navy', lw=2, linestyle='--', label='Random Classifier')
    plt.xlabel('False Positive Rate')
    plt.ylabel('True Positive Rate')
    plt.title(title)
    plt.legend(loc='lower right')
    plt.grid(True)
    plt.savefig(save_path)
    plt.close()
    print(f"ROC curve saved to {save_path}")


def plot_precision_recall_curve(y_true, y_pred, save_path, title='Precision-Recall Curve'):
    precision, recall, _ = precision_recall_curve(y_true, y_pred)
    plt.figure(figsize=(8, 6))
    plt.plot(recall, precision, color='blue', lw=2, label=f'Precision-Recall curve')
    plt.xlabel('Recall')
    plt.ylabel('Precision')
    plt.title(title)
    plt.legend(loc='lower left')
    plt.grid(True)
    plt.savefig(save_path)
    plt.close()
    print(f"Precision-Recall curve saved to {save_path}")



@torch.no_grad()
def predict_and_save(model, data_loader, device, save_path, args, emb, evaluator, id_to_protein_mapping):
    """
    Use the model to predict and save the results to the specified path in HDF5 format.
    
    Parameters:
    - model: Trained model used for prediction
    - data_loader: DataLoader object containing the data to be predicted
    - device: The device to run on, either CPU or CUDA
    - save_path: Path to save the prediction results
    - args: Command line arguments containing settings
    - emb: Node embedding, if applicable
    - evaluator: Evaluator object for evaluating results
    - id_to_protein_mapping: Dictionary mapping node IDs to protein IDs
    """
    model.eval()  # Set the model to evaluation mode (disable dropout and batchnorm)
    results = []

    with h5py.File(save_path, 'w') as h5f:
        # Create datasets for storing the predictions
        node_pairs_dataset = h5f.create_dataset('node_pairs', (0, 2), maxshape=(None, 2), dtype='i')
        protein_pairs_dataset = h5f.create_dataset('protein_pairs', (0, 2), maxshape=(None, 2), dtype=h5py.string_dtype(encoding='utf-8'))
        predictions_dataset = h5f.create_dataset('predictions', (0,), maxshape=(None,), dtype='f')
        true_labels_dataset = h5f.create_dataset('true_labels', (0,), maxshape=(None,), dtype='i')
        
        y_pred, y_true = [], []

        for data in tqdm(data_loader, ncols=70): 
            data = data.to(device)

            x = data.x if args.use_feature else None
            edge_weight = data.edge_weight if args.use_edge_weight else None
            node_id = data.node_id if emb else None
            logits = model(data.z, data.edge_index, data.batch, x, edge_weight, node_id)

            probabilities = torch.sigmoid(logits)
        
            src_nodes, dst_nodes = data.edge_index[0].cpu().numpy(), data.edge_index[1].cpu().numpy()
            predictions = probabilities.view(-1).cpu().numpy()
            true_labels = data.y.view(-1).cpu().numpy()

            for i in range(len(predictions)):
                src_protein_id = id_to_protein_mapping[int(src_nodes[i])]
                dst_protein_id = id_to_protein_mapping[int(dst_nodes[i])]

                # Prepare the data to append
                node_pair = np.array([[int(src_nodes[i]), int(dst_nodes[i])]])
                protein_pair = np.array([[src_protein_id, dst_protein_id]], dtype='S')  # Store as bytes
                prediction = np.array([predictions[i]])
                true_label = np.array([true_labels[i]])

                # Resize datasets to accommodate new data
                node_pairs_dataset.resize((node_pairs_dataset.shape[0] + 1, 2))
                protein_pairs_dataset.resize((protein_pairs_dataset.shape[0] + 1, 2))
                predictions_dataset.resize((predictions_dataset.shape[0] + 1,))
                true_labels_dataset.resize((true_labels_dataset.shape[0] + 1,))

                # Append new data
                node_pairs_dataset[-1] = node_pair
                protein_pairs_dataset[-1] = protein_pair
                predictions_dataset[-1] = prediction
                true_labels_dataset[-1] = true_label

            # **收集 y_pred 和 y_true 用于计算指标**
            y_pred.append(logits.view(-1).cpu())
            y_true.append(data.y.view(-1).cpu().to(torch.float))


    print(f"Predictions have been saved to {save_path}")

    # **计算并打印评估指标**
    test_pred, test_true = torch.cat(y_pred), torch.cat(y_true)
    pos_test_pred = test_pred[test_true == 1]
    neg_test_pred = test_pred[test_true == 0]

    # **绘制 ROC 曲线**
    # plot_roc_curve(test_true.numpy(), test_pred.numpy(), save_path=None, title="Test ROC Curve")
    # plot_precision_recall_curve(test_true.numpy(), test_pred.numpy(), save_path=None, title="Test Precision-Recall Curve")

    # **计算并打印各种评估指标**
    results = {}
    for metric in args.eval_metrics:
        # if metric == 'hits':
        #     results.update(evaluate_hits(pos_test_pred, neg_test_pred, pos_test_pred, neg_test_pred, evaluator))
        # elif metric == 'mrr':
        #     results.update(evaluate_mrr(pos_test_pred, neg_test_pred, pos_test_pred, neg_test_pred, evaluator))
        # elif metric == 'rocauc':
        #     results.update(evaluate_rocauc(pos_test_pred, neg_test_pred, pos_test_pred, neg_test_pred))

        if metric == 'fdr':
            results.update(evaluate_fdr(test_pred, test_true, test_pred, test_true))
        elif metric == 'precision':
            results.update(evaluate_precision(test_pred, test_true, test_pred, test_true))
        elif metric == 'recall':
            results.update(evaluate_recall(test_pred, test_true, test_pred, test_true))
        elif metric == 'f1':
            results.update(evaluate_f1(test_pred, test_true, test_pred, test_true))
        elif metric == 'auc':
            results.update(evaluate_auc(test_pred, test_true, test_pred, test_true))
    # **打印评估结果**
    print("\nEvaluation Results:")
    for key, value in results.items():
        if isinstance(value, tuple):
            formatted = ", ".join(f"{v:.4f}" for v in value)
            print(f"{key}: ({formatted})")
        else:
            print(f"{key}: {value:.4f}")



@torch.no_grad()
def predict_and_save_filtered(model, data_loader, device, save_path, args, emb, 
                             id_to_protein_mapping,):
    model.eval()
    predictions_list = []
    
    for data in tqdm(data_loader, ncols=70, desc="Predicting"):
        data = data.to(device)
        

        # === 模型预测 ===
        logits = model(
            data.z, 
            data.edge_index, 
            data.batch,
            data.x if args.use_feature else None,
            data.edge_weight if args.use_edge_weight else None,
            data.node_id if emb else None
        )
        probabilities = torch.sigmoid(logits).view(-1).cpu().numpy()
        
        # === 获取目标边的全局ID ===
        # 从 data.target_edge 中获取（需在数据集类中实现）
        target_edge = data.target_edge.T  # 转置操作
        src_global = target_edge[0].cpu().numpy().tolist()
        dst_global = target_edge[1].cpu().numpy().tolist()
        
        # === 转换到蛋白质名称 ===
        src_proteins = [id_to_protein_mapping.get(int(gid), f"UNK_{gid}") for gid in src_global]
        dst_proteins = [id_to_protein_mapping.get(int(gid), f"UNK_{gid}") for gid in dst_global]
        
        # === 存储结果 ===
        batch_predictions = list(zip(src_proteins, dst_proteins, probabilities))
        predictions_list.extend(batch_predictions)

        # print("Target edge shape:", data.target_edge.shape)  # 应该为 [2, N]
        # print("Logits shape:", logits.shape)                # 应该为 [N]
        # print(f"Batch中处理边数量: {len(src_global)}")
        # exit()

    # === 保存结果 ===
    df = pd.DataFrame(predictions_list, columns=["Protein1", "Protein2", "Prediction"])
    df.to_csv(save_path, index=False)
    print(f"\n✅ 预测结果已保存至 {save_path}")


@torch.no_grad()
def test_multiple_models(models, val_loader, test_loader, device, args, emb, evaluator):
    for m in models:
        m.eval()

    y_pred, y_true = [[] for _ in range(len(models))], [[] for _ in range(len(models))]
    for data in tqdm(val_loader, ncols=70):
        data = data.to(device)
        x = data.x if args.use_feature else None
        edge_weight = data.edge_weight if args.use_edge_weight else None
        node_id = data.node_id if emb else None
        for i, m in enumerate(models):
            logits = m(data.z, data.edge_index, data.batch, x, edge_weight, node_id)
            y_pred[i].append(logits.view(-1).cpu())
            y_true[i].append(data.y.view(-1).cpu().to(torch.float))
    val_pred = [torch.cat(y_pred[i]) for i in range(len(models))]
    val_true = [torch.cat(y_true[i]) for i in range(len(models))]
    pos_val_pred = [val_pred[i][val_true[i]==1] for i in range(len(models))]
    neg_val_pred = [val_pred[i][val_true[i]==0] for i in range(len(models))]

    y_pred, y_true = [[] for _ in range(len(models))], [[] for _ in range(len(models))]
    for data in tqdm(test_loader, ncols=70):
        data = data.to(device)
        x = data.x if args.use_feature else None
        edge_weight = data.edge_weight if args.use_edge_weight else None
        node_id = data.node_id if emb else None
        for i, m in enumerate(models):
            logits = m(data.z, data.edge_index, data.batch, x, edge_weight, node_id)
            y_pred[i].append(logits.view(-1).cpu())
            y_true[i].append(data.y.view(-1).cpu().to(torch.float))
    test_pred = [torch.cat(y_pred[i]) for i in range(len(models))]
    test_true = [torch.cat(y_true[i]) for i in range(len(models))]
    pos_test_pred = [test_pred[i][test_true[i]==1] for i in range(len(models))]
    neg_test_pred = [test_pred[i][test_true[i]==0] for i in range(len(models))]
    
    Results = []
    for i in range(len(models)):
        if args.eval_metric == 'hits':
            Results.append(evaluate_hits(pos_val_pred[i], neg_val_pred[i], 
                                        pos_test_pred[i], neg_test_pred[i]), evaluator)
        elif args.eval_metric == 'mrr':
            Results.append(evaluate_mrr(pos_val_pred[i], neg_val_pred[i], 
                                        pos_test_pred[i], neg_test_pred[i]), evaluator)
        elif args.eval_metric == 'rocauc':
            Results.append(evaluate_ogb_rocauc(pos_val_pred[i], neg_val_pred[i], 
                                        pos_test_pred[i], neg_test_pred[i]), evaluator)

        elif args.eval_metric == 'auc':
            Results.append(evaluate_auc(val_pred[i], val_true[i], 
                                        test_pred[i], test_pred[i]))
    return Results


def evaluate_hits(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred, evaluator):
    results = {}
    for K in [20, 50, 100]:
        evaluator.K = K
        valid_hits = evaluator.eval({
            'y_pred_pos': pos_val_pred,
            'y_pred_neg': neg_val_pred,
        })[f'hits@{K}']
        test_hits = evaluator.eval({
            'y_pred_pos': pos_test_pred,
            'y_pred_neg': neg_test_pred,
        })[f'hits@{K}']

        results[f'Hits@{K}'] = (valid_hits, test_hits)

    return results

def evaluate_mrr(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred, evaluator):
    neg_val_pred = neg_val_pred.view(pos_val_pred.shape[0], -1)
    neg_test_pred = neg_test_pred.view(pos_test_pred.shape[0], -1)
    results = {}
    valid_mrr = evaluator.eval({
        'y_pred_pos': pos_val_pred,
        'y_pred_neg': neg_val_pred,
    })['mrr_list'].mean().item()

    test_mrr = evaluator.eval({
        'y_pred_pos': pos_test_pred,
        'y_pred_neg': neg_test_pred,
    })['mrr_list'].mean().item()

    results['MRR'] = (valid_mrr, test_mrr)
    return results


def evaluate_auc(val_pred, val_true, test_pred, test_true):
    valid_auc = roc_auc_score(val_true, val_pred)
    test_auc = roc_auc_score(test_true, test_pred)
    results = {}
    results['AUC'] = (valid_auc, test_auc)

    return results


def evaluate_fdr_simple(val_pred, val_true, test_pred, test_true):
    """
    Calculate False Discovery Rate (FDR) for validation and test datasets.

    Args:
    - val_pred: Predictions for the validation set.
    - val_true: Ground truth for the validation set.
    - test_pred: Predictions for the test set.
    - test_true: Ground truth for the test set.

    Returns:
    - dict: FDR values for validation and test datasets.
    """
    results = {}

    # Convert logits to probabilities
    val_probabilities = torch.sigmoid(val_pred)
    test_probabilities = torch.sigmoid(test_pred)

    # Calculate the best threshold based on validation set
    precision, recall, thresholds = precision_recall_curve(val_true, val_probabilities)
    f1_scores = 2 * recall * precision / (recall + precision)
    best_threshold = thresholds[f1_scores.argmax()]

    # Use the best threshold for predictions
    val_predictions = (val_probabilities >= best_threshold).float()
    test_predictions = (test_probabilities >= best_threshold).float()


    # Calculate FDR for validation set
    TP_val = ((val_predictions == 1) & (val_true == 1)).sum().item()
    FP_val = ((val_predictions == 1) & (val_true == 0)).sum().item()
    FDR_val = FP_val / (FP_val + TP_val) if (FP_val + TP_val) > 0 else 0.0

    # Calculate FDR for test set
    TP_test = ((test_predictions == 1) & (test_true == 1)).sum().item()
    FP_test = ((test_predictions == 1) & (test_true == 0)).sum().item()
    FDR_test = FP_test / (FP_test + TP_test) if (FP_test + TP_test) > 0 else 0.0

    # Return FDR values as (valid_res, test_res)
    results['FDR'] = (FDR_val, FDR_test)

    return results



def calculate_metrics(pred, true, decoy_ratio=0.1):
    """
    Calculate the best threshold, predictions, and FDR for a given dataset.

    Args:
    - pred: Predictions (logits or probabilities).
    - true: Ground truth labels.
    - decoy_ratio: Ratio of negative samples to be used as Decoy Set. Default is 0.1.

    Returns:
    - fdr: Estimated False Discovery Rate for the dataset.
    """
    # Convert logits to probabilities
    probabilities = torch.sigmoid(pred)

    # Calculate the best threshold based on F1 score
    precision, recall, thresholds = precision_recall_curve(true, probabilities)
    f1_scores = 2 * recall * precision / (recall + precision + 1e-6)  # Add small value to prevent division by zero
    best_threshold = thresholds[f1_scores.argmax()]

    # Make predictions using the best threshold
    predictions = (probabilities >= best_threshold).float()

    # Generate Decoy Set
    neg_indices = (true == 0).nonzero().view(-1).cpu().numpy()
    decoy_size = int(len(neg_indices) * decoy_ratio)
    decoy_indices = np.random.choice(neg_indices, size=decoy_size, replace=False)
    decoy_probabilities = probabilities[decoy_indices]

    # Calculate empirical p-values
    empirical_p_values = []
    positive_indices = (true == 1).nonzero().view(-1).cpu().numpy()
    for idx in positive_indices:
        prob = probabilities[idx].item()
        p_value = (decoy_probabilities >= prob).sum() / len(decoy_probabilities)
        empirical_p_values.append(p_value)

    # Estimate FDR using Storey method
    empirical_p_values = np.array(empirical_p_values)
    lambda_threshold = 0.5
    pi_0 = (empirical_p_values > lambda_threshold).sum() / len(empirical_p_values) / (1 - lambda_threshold)
    estimated_fdr = pi_0 * np.mean(empirical_p_values)

    return estimated_fdr

def evaluate_fdr(val_pred, val_true, test_pred, test_true, decoy_ratio=0.3):
    """
    Calculate False Discovery Rate (FDR) for validation and test datasets.

    Args:
    - val_pred: Predictions for the validation set.
    - val_true: Ground truth for the validation set.
    - test_pred: Predictions for the test set.
    - test_true: Ground truth for the test set.
    - decoy_ratio: Ratio of negative samples to be used as Decoy Set. Default is 0.1.

    Returns:
    - dict: FDR values for validation and test datasets.
    """
    results = {}
    
    # Calculate FDR for validation set
    # FDR_val = calculate_metrics(val_pred, val_true, decoy_ratio)
    
    # Calculate FDR for test set
    # FDR_test = calculate_metrics(test_pred, test_true, decoy_ratio)

    # results['FDR'] = (FDR_val, FDR_test)

    # return results

    return evaluate_fdr_simple(val_pred, val_true, test_pred, test_true)


def evaluate_precision(val_pred, val_true, test_pred, test_true):
    # 使用 sigmoid 函数获取概率值
    val_probabilities = torch.sigmoid(val_pred)
    test_probabilities = torch.sigmoid(test_pred)

    # 计算 Precision 和 Recall 曲线，获取阈值和相应的 F1 分数
    val_precision, val_recall, val_thresholds = precision_recall_curve(val_true.cpu().numpy(), val_probabilities.cpu().detach().numpy())
    test_precision, test_recall, test_thresholds = precision_recall_curve(test_true.cpu().numpy(), test_probabilities.cpu().detach().numpy())

    # 计算 F1 分数
    val_f1_scores = 2 * val_recall * val_precision / (val_recall + val_precision + 1e-6)
    test_f1_scores = 2 * test_recall * test_precision / (test_recall + test_precision + 1e-6)

    # 选择最佳阈值（F1 分数最大时对应的阈值）
    best_val_threshold = val_thresholds[val_f1_scores.argmax()]
    best_test_threshold = test_thresholds[test_f1_scores.argmax()]

    # 使用最佳阈值进行预测
    val_pred_binary = (val_probabilities >= best_val_threshold).float()
    test_pred_binary = (test_probabilities >= best_test_threshold).float()

    # 计算最终的 Precision 分数
    val_precision_score = precision_score(val_true.cpu().numpy(), val_pred_binary.cpu().numpy())
    test_precision_score = precision_score(test_true.cpu().numpy(), test_pred_binary.cpu().numpy())

    # 返回 Precision 结果
    results = {}
    results['Precision'] = (val_precision_score, test_precision_score)
    return results

def evaluate_recall(val_pred, val_true, test_pred, test_true):
    # 使用 sigmoid 函数获取概率值
    val_probabilities = torch.sigmoid(val_pred)
    test_probabilities = torch.sigmoid(test_pred)

    # 计算 Precision 和 Recall 曲线，获取阈值和相应的 F1 分数
    val_precision, val_recall, val_thresholds = precision_recall_curve(val_true.cpu().numpy(), val_probabilities.cpu().detach().numpy())
    test_precision, test_recall, test_thresholds = precision_recall_curve(test_true.cpu().numpy(), test_probabilities.cpu().detach().numpy())

    # 计算 F1 分数
    val_f1_scores = 2 * val_recall * val_precision / (val_recall + val_precision + 1e-6)
    test_f1_scores = 2 * test_recall * test_precision / (test_recall + test_precision + 1e-6)

    # 选择最佳阈值（F1 分数最大时对应的阈值）
    best_val_threshold = val_thresholds[val_f1_scores.argmax()]
    best_test_threshold = test_thresholds[test_f1_scores.argmax()]

    # 使用最佳阈值进行预测
    val_pred_binary = (val_probabilities >= best_val_threshold).float()
    test_pred_binary = (test_probabilities >= best_test_threshold).float()

    # 计算最终的 Recall 分数
    val_recall_score = recall_score(val_true.cpu().numpy(), val_pred_binary.cpu().numpy())
    test_recall_score = recall_score(test_true.cpu().numpy(), test_pred_binary.cpu().numpy())

    # 返回 Recall 结果
    results = {}
    results['Recall'] = (val_recall_score, test_recall_score)
    return results

def evaluate_f1(val_pred, val_true, test_pred, test_true):
    # 使用 sigmoid 函数获取概率值
    val_probabilities = torch.sigmoid(val_pred)
    test_probabilities = torch.sigmoid(test_pred)

    # 计算 Precision 和 Recall 曲线，获取阈值和相应的 F1 分数
    val_precision, val_recall, val_thresholds = precision_recall_curve(val_true.cpu().numpy(), val_probabilities.cpu().detach().numpy())
    test_precision, test_recall, test_thresholds = precision_recall_curve(test_true.cpu().numpy(), test_probabilities.cpu().detach().numpy())

    # 计算 F1 分数
    val_f1_scores = 2 * val_recall * val_precision / (val_recall + val_precision + 1e-6)
    test_f1_scores = 2 * test_recall * test_precision / (test_recall + test_precision + 1e-6)

    # 选择最佳阈值（F1 分数最大时对应的阈值）
    best_val_threshold = val_thresholds[val_f1_scores.argmax()]
    best_test_threshold = test_thresholds[test_f1_scores.argmax()]

    # 使用最佳阈值进行预测
    val_pred_binary = (val_probabilities >= best_val_threshold).float()
    test_pred_binary = (test_probabilities >= best_test_threshold).float()

    # 计算最终的 F1 分数
    val_f1_score = f1_score(val_true.cpu().numpy(), val_pred_binary.cpu().numpy())
    test_f1_score = f1_score(test_true.cpu().numpy(), test_pred_binary.cpu().numpy())

    # 返回 F1 结果
    results = {}
    results['F1-score'] = (val_f1_score, test_f1_score)
    return results

def evaluate_ogb_rocauc(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred, evaluator):
    valid_rocauc = evaluator.eval({
        'y_pred_pos': pos_val_pred,
        'y_pred_neg': neg_val_pred,
        })[f'rocauc']

    test_rocauc = evaluator.eval({
            'y_pred_pos': pos_test_pred,
            'y_pred_neg': neg_test_pred,
        })[f'rocauc']

    results = {}
    results['rocauc'] = (valid_rocauc, test_rocauc)
    return results

def evaluate_rocauc(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred):
    """
    Evaluate ROC AUC for validation and test sets without using evaluator.eval.
    """
    # Combine positive and negative predictions for validation
    val_pred = torch.cat([pos_val_pred, neg_val_pred]).cpu().numpy()
    val_true = torch.cat([torch.ones(pos_val_pred.size(0)), torch.zeros(neg_val_pred.size(0))]).cpu().numpy()
    
    # Combine positive and negative predictions for testing
    test_pred = torch.cat([pos_test_pred, neg_test_pred]).cpu().numpy()
    test_true = torch.cat([torch.ones(pos_test_pred.size(0)), torch.zeros(neg_test_pred.size(0))]).cpu().numpy()

    # Compute ROC AUC
    valid_rocauc = roc_auc_score(val_true, val_pred)
    test_rocauc = roc_auc_score(test_true, test_pred)

    results = {}
    results['ROCAUC'] = (valid_rocauc, test_rocauc)
    return results

#%%

def main():
    # Data settings
    parser = argparse.ArgumentParser(description='OGBL (SEAL)')
    parser.add_argument('--dataset', type=str, default='ogbl-collab')
    parser.add_argument('--fast_split', action='store_true', 
                        help="for large custom datasets (not OGB), do a fast data split")

    # GNN settings
    parser.add_argument('--model', type=str, default='DGCNN')
    parser.add_argument('--sortpool_k', type=float, default=0.6) #0.6
    parser.add_argument('--num_layers', type=int, default=3) #3
    parser.add_argument('--hidden_channels', type=int, default=32) #32
    parser.add_argument('--batch_size', type=int, default=1) #32  # for each subgraph, add 1.
    # Subgraph extraction settings
    parser.add_argument('--num_subdatasets', type=int, default=1, help="number of subdatasets")
    # parser.add_argument('--subgraphs_path', type=str, default="/media/weimin/8T_3/Angdi/subgraphs.h5" )
    parser.add_argument('--subgraphs_path', type=str, default="./subgraphs.h5" )
    parser.add_argument('--num_hops', type=int, default=1)
    parser.add_argument('--ratio_per_hop', type=float, default=1.0)
    parser.add_argument('--max_nodes_per_hop', type=int, default=None)
    parser.add_argument('--node_label', type=str, default='drnl', 
                        help="which specific labeling trick to use")
    parser.add_argument('--use_feature', action='store_true', 
                        help="whether to use raw node features as GNN input")
    parser.add_argument('--use_edge_weight', action='store_true', 
                        help="whether to consider edge weight in GNN")
    # Training settings
    parser.add_argument('--lr', type=float, default=0.0001)
    parser.add_argument('--epochs', type=int, default=5)
    parser.add_argument('--runs', type=int, default=1)
    parser.add_argument('--train_percent', type=float, default=100)# 100
    parser.add_argument('--val_percent', type=float, default=100) # 100
    parser.add_argument('--test_percent', type=float, default=100) # 100
    parser.add_argument('--dynamic_train', action='store_true', 
                        help="dynamically extract enclosing subgraphs on the fly")
    parser.add_argument('--dynamic_val', action='store_true')
    parser.add_argument('--dynamic_test', action='store_true')
    parser.add_argument('--num_workers', type=int, default=8, 
                        help="number of workers for dynamic mode; 0 if not dynamic")
    parser.add_argument('--train_node_embedding', action='store_true',  default=False,
                        help="also train free-parameter node embeddings together with GNN")
    parser.add_argument('--pretrained_node_embedding', type=str, default=None, 
                        help="load pretrained node embeddings as additional node features")
    parser.add_argument('--use_attribute', action='store_true', help='Use attributes if available')
    parser.add_argument('--use_node2vec', action='store_true', help='Use node2vec embeddings')
                    
    # Testing settings
    parser.add_argument('--use_valedges_as_input', action='store_true')
    parser.add_argument('--eval_steps', type=int, default=1)
    parser.add_argument('--log_steps', type=int, default=1)
    parser.add_argument('--data_appendix', type=str, default='', 
                        help="an appendix to the data directory")
    parser.add_argument('--save_appendix', type=str, default='', 
                        help="an appendix to the save directory")
    parser.add_argument('--keep_old', action='store_true', 
                        help="do not overwrite old files in the save directory")
    parser.add_argument('--continue_from', type=int, default=None, 
                        help="from which epoch's checkpoint to continue training")
    parser.add_argument('--resume_dir', type=str, default=None, 
                    help="Directory to load checkpoints from for continuing training")


    parser.add_argument('--only_test', action='store_true', 
                        help="only test without training")
    parser.add_argument('--test_multiple_models', action='store_true', 
                        help="test multiple models together")
    parser.add_argument('--use_heuristic', type=str, default=None, 
                        help="test a link prediction heuristic (CN or AA)")


    parser.add_argument('--only_pred', action='store_true', 
                        help="only predict results")
    parser.add_argument('--only_pred_nodes', action='store_true', 
                        help="only predict results")
    parser.add_argument('--only_pred_finetunenodes', action='store_true',
                        help="only predict results")
    parser.add_argument('--add_newexpression', action='store_true', 
                        help="use new expression for prediction")

    parser.add_argument('--finetune', action='store_true',default=False,
                        help="finetune the model")
    parser.add_argument('--epoch', type=int, default=0,
                        help="record the current epoch")

    
    args = parser.parse_args()
    
    # cmd_args = [
    #     '--dataset', 'custom_ppi',
    #     '--num_workers', '20',
    #     '--num_subdatasets', '1',
    #     '--batch_size', '16',
    #     '--num_hops', '2',
    #     '--use_feature',
    #     '--dynamic_train',
    #     '--dynamic_val',
    #     '--dynamic_test',


    #     '--eval_steps', '1',
    #     '--epochs', '5',

    #     '--train_percent', '100',
    #     '--use_node2vec'
    # ]

        # python seal_link_pred.py --dataset custom_ppi --num_workers 20 --num_subdatasets 1 --batch_size 16 --num_hops 2 --use_feature --dynamic_train --dynamic_val --dynamic_test --eval_steps 5 --runs 1 --epochs 50 --train_percent 80 --use_node2vec

    # cmd_args = [
    #     '--dataset', 'ogbl-ppa',
    #     '--batch_size', '1',
    #     '--num_hops', '1',
    #     '--use_feature',
    #     '--eval_steps', '1',
    #     '--epochs', '5',
    #     '--train_percent', '0.005',
    #     '--use_node2vec'
    # ]

    # cmd_args = [
    #     '--dataset', 'custom_ppi',
    #     '--num_workers', '64',
    #     '--num_subdatasets', '1',
    #     '--batch_size', '128',
    #     '--num_hops', '1',
    #     '--use_feature',
    #     '--dynamic_train',
    #     '--dynamic_val',
    #     '--dynamic_test',
    #     '--eval_steps', '1',
    #     '--runs', '1',
    #     '--epochs', '500',
    #     '--train_percent', '100',
    #     '--use_node2vec'
    # ]
    # python seal_link_pred.py --dataset custom_ppi --num_workers 128 --num_subdatasets 1 --batch_size 64 --num_hops 1 --use_feature --dynamic_train --dynamic_val --dynamic_test --eval_steps 3 --runs 1 --epochs 500 --train_percent 100 --use_node2vec

    # args = parser.parse_args(cmd_args)




    if args.save_appendix == '':
        args.save_appendix = '_' + time.strftime("%Y%m%d%H%M%S")
    if args.data_appendix == '':
        args.data_appendix = '_h{}_{}_rph{}'.format(
            args.num_hops, args.node_label, ''.join(str(args.ratio_per_hop).split('.')))
        if args.max_nodes_per_hop is not None:
            args.data_appendix += '_mnph{}'.format(args.max_nodes_per_hop)
        if args.use_valedges_as_input:
            args.data_appendix += '_uvai'

    args.res_dir = os.path.join('results/{}{}'.format(args.dataset, args.save_appendix))
    print('Results will be saved in ' + args.res_dir)
    if not os.path.exists(args.res_dir):
        os.makedirs(args.res_dir) 
    if not args.keep_old:
        # Backup python files.
        copy('seal_link_pred.py', args.res_dir)
        copy('utils.py', args.res_dir)
        copy('custom_dataset.py', args.res_dir)
    log_file = os.path.join(args.res_dir, 'log.txt')
    # Save command line input.
    cmd_input = 'python ' + ' '.join(sys.argv) + '\n'
    with open(os.path.join(args.res_dir, 'cmd_input.txt'), 'a') as f:
        f.write(cmd_input)
    print('Command line input: ' + cmd_input + ' is saved.')
    with open(log_file, 'a') as f:
        f.write('\n' + cmd_input)

    if args.dataset.startswith('ogbl'):
        dataset = PygLinkPropPredDataset(name=args.dataset)
        split_edge = dataset.get_edge_split()
        data = dataset[0]
        if args.dataset.startswith('ogbl-vessel'):
            # normalize node features
            data.x[:, 0] = torch.nn.functional.normalize(data.x[:, 0], dim=0)
            data.x[:, 1] = torch.nn.functional.normalize(data.x[:, 1], dim=0)
            data.x[:, 2] = torch.nn.functional.normalize(data.x[:, 2], dim=0)
    
    elif args.dataset.startswith('finetune'):
        # 检查 continue_from 不为 None
        assert args.continue_from is not None, "continue_from should not be None"
        args.finetune = True

        dataset = load_finetune_localdata()
        id_to_protein_mapping = dataset.id_to_protein
        
        split_edge = dataset.get_edge_split()  # for finetuning splitting

        data = dataset[0]
        data_graph = dataset.get_graph_dataset()
        split_edge_graph = dataset.split_edge_graph
        train_graph_data = dataset.train_dataset # for build graph
        



    else:

        # path = osp.join('dataset', args.dataset)
        # dataset = Planetoid(path, args.dataset)
        # split_edge = do_edge_split(dataset, args.fast_split)
        # data = dataset[0]
        # data.edge_index = split_edge['train']['edge'].t()
        print('load origional data')
        dataset = load_localdata()
        id_to_protein_mapping = dataset.id_to_protein

        split_edge = dataset.get_edge_split() 
        data = dataset[0]
        train_graph_data = dataset.train_dataset

        # split_dir = osp.join(dataset.root, 'split', 'throughput')
        # os.makedirs(split_dir, exist_ok=True)  # 创建文件夹

        # torch.save(split_edge['train'], osp.join(split_dir, 'train.pt'))  # 保存训练集边
        # torch.save(split_edge['valid'], osp.join(split_dir, 'valid.pt'))  # 保存验证集边
        # torch.save(split_edge['test'], osp.join(split_dir, 'test.pt'))    # 保存测试集边

        # processed_dir = osp.join(dataset.root, 'processed')
        # os.makedirs(processed_dir, exist_ok=True)
        
        # torch.save(data, osp.join(processed_dir, 'geometric_data_processed.pt'))






    if args.only_pred_finetunenodes:  #  !!  for predictions 
        # with open(id_to_protein_mapping_file, "r") as f:
        #     id_to_protein_mapping = json.load(f)

        assert args.continue_from is not None, "continue_from should not be None"
        args.finetune = True
        


        if args.add_newexpression == True:
            #expression_data_file = "dataset/custom_ppi/raw_coexpress_data/DIO_chow-7T_1-10-20250320(1)_new_data.csv"
            # expression_data_file = "dataset/custom_ppi/raw_coexpress_data/DIO_chow-12T_1-10-20250320(1)_new_data.csv"
            #/media/luoht/新加卷/luoht/seal_ppi/dataset/custom_ppi/finetune_data/MT22/01.Expression_MT22-7T_1-10-20241206.csv
            expression_data_file = "dataset/custom_ppi/finetune_data/MT22/DIANN1.8.1Re-Old.pg_matrix_processed_v3.csv"
            dataset = load_finetune_localdata(new_expssion_data = expression_data_file)
        else:
            dataset = load_finetune_localdata()

        id_to_protein_mapping = dataset.id_to_protein
        protein_to_id_mapping = {prot_name: int(idx) for idx, prot_name in id_to_protein_mapping.items()}


        print(f"Number of proteins (length): {len(id_to_protein_mapping)}")
        print(f"Max protein ID: {max(map(int, id_to_protein_mapping.keys()))}")


        split_edge = dataset.get_edge_split()  # for finetuning splitting
        # split_edge =split_edge["all"]



        data = dataset[0]
        data_graph = dataset.get_graph_dataset()  # all including all edges
        split_edge_graph = dataset.split_edge_graph  # all including all edges  'all'



        # loading pred-need edges
        # pred_req_file_name = 'MT22_raw_predict'  dataset/custom_ppi/pred_required/unknow_label_3_20.csv
        #pred_req_file_name =  '4_22_pre_formatted'  #'DIO-chow_rawraw_pos-20250326_formatted' # 'TP for EXP of Glp1r'  # 'unknow_label_3_20' 
        pred_req_file_name =  '20250930_TMP_TMP'  

        edge_file = f'dataset/custom_ppi/pred_required/{pred_req_file_name}.csv'




        edge_df = pd.read_csv(edge_file)
        # 选取前 10,000 行
        # edge_df = edge_df.head(10000)  # 或 edge_df.iloc[:10000]

        # 4. 将蛋白质名转换成数值 ID   # "Interactor.A","Interactor.B"
        pred_edge_index = []

        for row in edge_df.itertuples(index=False, name=None):  # name=None 让其返回普通元组
            protein1 = row[0]  # 第一列
            protein2 = row[1]  # 第二列

            if protein1 in protein_to_id_mapping and protein2 in protein_to_id_mapping:
                # 获取数值 ID
                id1 = protein_to_id_mapping[protein1]
                id2 = protein_to_id_mapping[protein2]
                pred_edge_index.append([id1, id2])
            else:
                # 处理未找到的蛋白质
                print(f"WARNING: {protein1} 或 {protein2} 不在 mapping 中，跳过该对蛋白质。")

        pred_edge_index = np.array(pred_edge_index)  ## ok

        print(pred_edge_index[:5])

        # ----------

        # pred_edge_protein_names = []
        # for edge in pred_edge_index:
        #     id1, id2 = edge
        #     # 使用 id_to_protein_mapping 将 ID 映射回蛋白质名称
        #     protein1 = id_to_protein_mapping[int(id1)]
        #     protein2 = id_to_protein_mapping[int(id2)]
        #     pred_edge_protein_names.append([protein1, protein2])

        # # 打印前五行
        # print("Mapped protein names (first 5 rows):")
        # for i, edge in enumerate(pred_edge_protein_names[:5]):
        #     print(f"Row {i + 1}: {edge}")






        # 转为张量形状 [2, num_pred_edges]，这是 PyG 常用的 edge_index 格式
        pred_edge_index = torch.tensor(pred_edge_index, dtype=torch.long).t()  # shape: [2, E]



        pred_data = Data(
            num_nodes=data_graph.num_nodes,
            x0=data_graph.x0,
            x=data_graph.x,
            edge_index=pred_edge_index,

            )
        
        split_edge_pred = split_pred_edges(pred_edge_index)
        # split_edge_pred = split_edge_pred["all"]  # target_edges 是 [2, E] 的 tensor


        train_graph_data = data_graph # for loading training dataset to build graph 









    if args.dataset.startswith('ogbl-citation'):
        args.eval_metrics = ['mrr']
        directed = True
    elif args.dataset.startswith('ogbl-vessel'):
        args.eval_metrics = ['rocauc']
        directed = False
    elif args.dataset.startswith('ogbl'):
        args.eval_metrics = ['hits']
        directed = False
    else:  # assume other datasets are undirected
        args.eval_metrics = ['auc','rocauc', 'fdr','hits','precision','recall','f1']  # 可以根据需要添加多个评估指标
        directed = False

    # 2. 使用验证集作为输入
    if args.use_valedges_as_input:
        val_edge_index = split_edge['valid']['edge'].t()
        if not directed:
            val_edge_index = to_undirected(val_edge_index)
        data.edge_index = torch.cat([data.edge_index, val_edge_index], dim=-1)
        if 'edge_weight' in data:
            val_edge_weight = torch.ones([val_edge_index.size(1), 1], dtype=int)
            data.edge_weight = torch.cat([data.edge_weight, val_edge_weight], 0)

    # 3. 初始化评估器
    if args.dataset.startswith('ogbl'):
        evaluator = Evaluator(name=args.dataset)
    else:
        evaluator = Evaluator(name='ogbl-ppa')  # use ogbl-ppa for other datasets as an example

    # 4. 根据 `args.eval_metrics` 初始化日志记录器
    loggers = {}
    for metric in args.eval_metrics:
        if metric == 'hits':
            for k in [20, 50, 100]:
                loggers[f'Hits@{k}'] = Logger(args.runs, args)
        elif metric == 'mrr':
            loggers['MRR'] = Logger(args.runs, args)
        elif metric == 'rocauc':
            loggers['ROCAUC'] = Logger(args.runs, args)
        elif metric == 'precision':
            loggers['Precision'] = Logger(args.runs, args)
        elif metric == 'recall':
            loggers['Recall'] = Logger(args.runs, args)
        elif metric == 'f1':
            loggers['F1-score'] = Logger(args.runs, args)      
        elif metric == 'auc':
            loggers['AUC'] = Logger(args.runs, args)
        elif metric == 'fdr':
            loggers['FDR'] = Logger(args.runs, args)
        

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(device)


    if args.use_heuristic:
        # Test link prediction heuristics.
        num_nodes = data.num_nodes
        if 'edge_weight' in data:
            edge_weight = data.edge_weight.view(-1)
        else:
            edge_weight = torch.ones(data.edge_index.size(1), dtype=int)

        A = ssp.csr_matrix((edge_weight, (data.edge_index[0], data.edge_index[1])), 
                        shape=(num_nodes, num_nodes))

        pos_val_edge, neg_val_edge = get_pos_neg_edges('valid', split_edge, 
                                                    data.edge_index, 
                                                    data.num_nodes)
        pos_test_edge, neg_test_edge = get_pos_neg_edges('test', split_edge, 
                                                        data.edge_index, 
                                                        data.num_nodes)
        pos_val_pred, pos_val_edge = eval(args.use_heuristic)(A, pos_val_edge)
        neg_val_pred, neg_val_edge = eval(args.use_heuristic)(A, neg_val_edge)
        pos_test_pred, pos_test_edge = eval(args.use_heuristic)(A, pos_test_edge)
        neg_test_pred, neg_test_edge = eval(args.use_heuristic)(A, neg_test_edge)

        if args.eval_metric == 'hits':
            results = evaluate_hits(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred, evaluator)
        elif args.eval_metric == 'mrr':
            results = evaluate_mrr(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred, evaluator)
        elif args.eval_metric == 'rocauc':
            results = evaluate_ogb_rocauc(pos_val_pred, neg_val_pred, pos_test_pred, neg_test_pred, evaluator)
        elif args.eval_metric == 'auc':
            val_pred = torch.cat([pos_val_pred, neg_val_pred])
            val_true = torch.cat([torch.ones(pos_val_pred.size(0), dtype=int), 
                                torch.zeros(neg_val_pred.size(0), dtype=int)])
            test_pred = torch.cat([pos_test_pred, neg_test_pred])
            test_true = torch.cat([torch.ones(pos_test_pred.size(0), dtype=int), 
                                torch.zeros(neg_test_pred.size(0), dtype=int)])
            results = evaluate_auc(val_pred, val_true, test_pred, test_true)

        for key, result in results.items():
            loggers[key].add_result(0, result)
        for key in loggers.keys():
            print(key)
            loggers[key].print_statistics()
            with open(log_file, 'a') as f:
                print(key, file=f)
                loggers[key].print_statistics(f=f)
        pdb.set_trace()
        exit()



    # SEAL.
    path = dataset.root + 'costom_seal{}'.format(args.data_appendix)
    use_coalesce = True if args.dataset == 'ogbl-collab' else False
    if not args.dynamic_train and not args.dynamic_val and not args.dynamic_test:
        args.num_workers = 0





    if args.finetune:

        dataset_class = 'SEALDynamicDataset_finetune' if args.dynamic_train else 'SEALDataset'
        train_dataset = eval(dataset_class)(
            path, 
            data, 
            data_graph,
            split_edge, 
            split_edge_graph,
            num_hops=args.num_hops, 
            percent=args.train_percent, 
            split='train', 
            use_coalesce=use_coalesce, 
            node_label=args.node_label, 
            ratio_per_hop=args.ratio_per_hop, 
            max_nodes_per_hop=args.max_nodes_per_hop, 
            directed=False,  # should change?
            cache_path= args.subgraphs_path,
            split_type ='train',
        ) 


        dataset_class = 'SEALDynamicDataset_finetune' if args.dynamic_val else 'SEALDataset'
        val_dataset = eval(dataset_class)(
            path, 
            data, 
            data_graph,
            split_edge, 
            split_edge_graph,
            num_hops=args.num_hops, 
            percent=args.val_percent, 
            split='valid', 
            use_coalesce=use_coalesce, 
            node_label=args.node_label, 
            ratio_per_hop=args.ratio_per_hop, 
            max_nodes_per_hop=args.max_nodes_per_hop, 
            directed=False, 
            cache_path= args.subgraphs_path,
            split_type ='val',
        )

        dataset_class = 'SEALDynamicDataset_finetune' if args.dynamic_test else 'SEALDataset'
        test_dataset = eval(dataset_class)(
            path, 
            data, 
            data_graph,
            split_edge, 
            split_edge_graph,
            num_hops=args.num_hops, 
            percent=args.test_percent, 
            split='test', 
            use_coalesce=use_coalesce, 
            node_label=args.node_label, 
            ratio_per_hop=args.ratio_per_hop, 
            max_nodes_per_hop=args.max_nodes_per_hop, 
            directed=False, 
            cache_path= args.subgraphs_path,
            split_type ='test',
        )

        if args.only_pred_finetunenodes:
            dataset_class = 'SEALDynamicDataset_finetune' if args.dynamic_train else 'SEALDataset'
            full_dataset = eval(dataset_class)(
                path, 
                pred_data, 
                data_graph,
                split_edge_pred, 
                split_edge_graph,
                num_hops=args.num_hops, 
                percent=args.train_percent, 
                split='all', 
                use_coalesce=use_coalesce, 
                node_label=args.node_label, 
                ratio_per_hop=args.ratio_per_hop, 
                max_nodes_per_hop=args.max_nodes_per_hop, 
                directed=False,  # should change?
                cache_path= args.subgraphs_path,
                split_type ='all',
            ) 
        else:

            full_dataset = cp.deepcopy(train_dataset)





    else:

        dataset_class = 'SEALDynamicDataset' if args.dynamic_train else 'SEALDataset'
        train_dataset = eval(dataset_class)(
            path, 
            data, 
            split_edge, 
            num_hops=args.num_hops, 
            percent=args.train_percent, 
            split='train', 
            use_coalesce=use_coalesce, 
            node_label=args.node_label, 
            ratio_per_hop=args.ratio_per_hop, 
            max_nodes_per_hop=args.max_nodes_per_hop, 
            directed=False,  # should change?
            cache_path= args.subgraphs_path,
            split_type ='train',
        ) 






        dataset_class = 'SEALDynamicDataset' if args.dynamic_val else 'SEALDataset'
        val_dataset = eval(dataset_class)(
            path, 
            data, 
            split_edge, 
            num_hops=args.num_hops, 
            percent=args.val_percent, 
            split='valid', 
            use_coalesce=use_coalesce, 
            node_label=args.node_label, 
            ratio_per_hop=args.ratio_per_hop, 
            max_nodes_per_hop=args.max_nodes_per_hop, 
            directed=False, 
            cache_path= args.subgraphs_path,
            split_type ='val',
        )

        dataset_class = 'SEALDynamicDataset' if args.dynamic_test else 'SEALDataset'
        test_dataset = eval(dataset_class)(
            path, 
            data, 
            split_edge, 
            num_hops=args.num_hops, 
            percent=args.test_percent, 
            split='test', 
            use_coalesce=use_coalesce, 
            node_label=args.node_label, 
            ratio_per_hop=args.ratio_per_hop, 
            max_nodes_per_hop=args.max_nodes_per_hop, 
            directed=False, 
            cache_path= args.subgraphs_path,
            split_type ='test',
        )


        if args.only_pred_nodes:
            dataset_class = 'SEALDynamicDataset' if args.dynamic_train else 'SEALDataset'
            full_dataset = eval(dataset_class)(
                path, 
                pred_data, 
                data_graph,
                split_edge_pred, 
                split_edge_graph,
                num_hops=args.num_hops, 
                percent=args.train_percent, 
                split='all', 
                use_coalesce=use_coalesce, 
                node_label=args.node_label, 
                ratio_per_hop=args.ratio_per_hop, 
                max_nodes_per_hop=args.max_nodes_per_hop, 
                directed=False,  # should change?
                cache_path= args.subgraphs_path,
                split_type ='all',
            ) 


        else:

            full_dataset = cp.deepcopy(test_dataset)
        # dataset_class = 'SEALDynamicDataset' if args.dynamic_test else 'SEALDataset'
        # full_dataset = eval(dataset_class)(
        #     path, 
        #     data, 
        #     split_edge, 
        #     num_hops=args.num_hops, 
        #     percent=100,  # 使用整个数据集
        #     split='all', 
        #     use_coalesce=use_coalesce, 
        #     node_label=args.node_label, 
        #     ratio_per_hop=args.ratio_per_hop, 
        #     max_nodes_per_hop=args.max_nodes_per_hop, 
        #     directed=False, 
        #     cache_path=args.subgraphs_path,
        #     split_type='all',
        # )

        # def __init__(self, root, data, data_graph, split_edge, split_edge_graph, num_hops, percent=100, split='train', 
        #             use_coalesce=False, node_label='drnl', ratio_per_hop=1.0, 
        #             max_nodes_per_hop=None, directed=False, 
        #             force_recompute=False, split_type='train', **kwargs):




    print('train_dataset:', len(train_dataset))
    print('val_dataset:', len(val_dataset))
    print('test_dataset:', len(test_dataset))
    print('full_dataset:', len(full_dataset))

    if args.only_pred_finetunenodes:
        # 查看 pred_data 中的原始边（假设边存储在 split_edge_pred['edge'] 中）
        print("\n=== pred_data 中的原始边（前5条） ===")
        raw_edges = split_edge_pred['all']['edge'].t()[:5].tolist()  # 转换为 (src, dst) 格式
        for i, (src, dst) in enumerate(raw_edges):
            # 将数值 ID 转换为蛋白质名称
            protein_src = id_to_protein_mapping[int(src)]
            protein_dst = id_to_protein_mapping[int(dst)]
            print(f"Edge {i}: {protein_src} <-> {protein_dst} (ID: {src}->{dst})")
        # 查看 full_dataset 中的前5条边（基于 links）
        print("\n=== full_dataset 中的前5条边 ===")
        for i, (src, dst) in enumerate(full_dataset.links[:5]):
            # 将数值 ID 转换为蛋白质名称
            protein_src = id_to_protein_mapping[int(src)]
            protein_dst = id_to_protein_mapping[int(dst)]
            print(f"Edge {i}: {protein_src} <-> {protein_dst} (ID: {src}->{dst})")






    num_subdatasets = args.num_subdatasets
    dataset_length = len(train_dataset)
    subdataset_size = dataset_length // num_subdatasets


    # 计算每个子数据集的大小
    indices = list(range(dataset_length))  # 获取所有索引
    random.shuffle(indices)  # 如果需要随机划分，打乱索引
    subdatasets = []

    # 划分子数据集
    for i in range(num_subdatasets):
        start = i * subdataset_size
        end = start + subdataset_size
        subdatasets.append(Subset(train_dataset, indices[start:end]))

    # 将剩余数据追加到最后一个子数据集
    if dataset_length % num_subdatasets != 0:
        remaining_indices = indices[num_subdatasets * subdataset_size:]
        subdatasets[-1] = Subset(train_dataset, subdatasets[-1].indices + remaining_indices)



    train_subdatasets = subdatasets
    for i, subdataset in enumerate(train_subdatasets):
        print(f"Subdataset {i}: size = {len(subdataset)}")


    # max_z = 1000  # set a large max_z so that every z has embeddings to look up
    max_z = 10000




    val_loader = DataLoader(val_dataset, batch_size=args.batch_size, 
                            num_workers=args.num_workers)
    test_loader = DataLoader(test_dataset, batch_size=args.batch_size, 
                            num_workers=args.num_workers)
    full_loader = DataLoader(full_dataset, batch_size=args.batch_size, 
                            num_workers=args.num_workers)
    torch.cuda.empty_cache() 

    # for batch in loader:

    #     print(batch)
    #     print("Batch x size:", batch.x.size())
    #     print("Batch edge_index size:", batch.edge_index.size())


    # # 检查加载后的数据
    # for data in train_loader:
    #     print("Maximum node ID:", data.edge_index.max().item())
    #     if data.edge_index.max().item() >= data.num_nodes:
    #         print("Mismatch detected in batch")


    import networkx as nx

    if args.train_node_embedding:
        emb = torch.nn.Embedding(data.num_nodes, args.hidden_channels).to(device)
    elif args.pretrained_node_embedding:
        weight = torch.load(args.pretrained_node_embedding)
        emb = torch.nn.Embedding.from_pretrained(weight)
        emb.weight.requires_grad=False

    elif args.use_node2vec:
        # train_data = Data(
        #     x=data.x,  # 仍然保持所有节点
        #     x0=data.x0, 
        #     # node_id=data.node_id,
        #     edge_index=split_edge['train']['edge'].t()  # 只传训练集的边
        # )

        # graph = convert_to_networkx(train_data)    # 你的图的表示，可能是邻接矩阵或网络X图对象
        graph = convert_to_networkx(train_graph_data)
        graph_csr = sparse.csr_matrix(nx.adjacency_matrix(graph))
        # A = nx.adjacency_matrix(graph) 
        emb = generate_node2vec_embeddings(graph_csr, args.hidden_channels, False, None, nums_workers=4).to(device)

    else:
        emb = None


    # def inspect_data_loader(data_loader):
    #     for batch_idx, data in enumerate(data_loader):
    #         if data.edge_index.numel() > 0:  # 确保有边存在
    #             max_node_id = data.edge_index.max().item()
    #             print(f"Batch {batch_idx}: Max node ID = {max_node_id}")

    # # 应用这个函数到你的DataLoader
    # print("Inspecting train loader:")
    # inspect_data_loader(train_loader)
    # print("Inspecting validation loader:")
    # inspect_data_loader(val_loader)
    # print("Inspecting test loader:")
    # inspect_data_loader(test_loader)


    # def find_max_node_id(data_loader):
    #     max_node_id = 0
    #     for data in data_loader:
    #         if data.edge_index.size(1) > 0:  # 确保边索引非空
    #             current_max = data.edge_index.max().item()
    #             if current_max > max_node_id:
    #                 max_node_id = current_max
    #     return max_node_id

    # 分别检查训练、验证和测试加载器
    # max_node_id_train = find_max_node_id(train_loader)
    # max_node_id_val = find_max_node_id(val_loader)
    # max_node_id_test = find_max_node_id(test_loader)

    # print("Maximum node ID in train dataloader:", max_node_id_train)
    # print("Maximum node ID in validation dataloader:", max_node_id_val)
    # print("Maximum node ID in test dataloader:", max_node_id_test)


    # # Check maximum node ID in datasets
    # max_node_id_train = max(
    #     (data.edge_index.max().item() for data in train_dataset if data.edge_index.numel() > 0),
    #     default=-1  # 默认值，如果所有的 edge_index 都是空的
    # )
    # # print('Maximum node ID in train dataset:', max_node_id_train)
    # # max_node_id_train = max([data.edge_index.max().item() for data in train_dataset])
    # max_node_id_val = max(
    #     (data.edge_index.max().item() for data in val_dataset if data.edge_index.numel() > 0),
    #     default=-1  # 默认值，如果所有的 edge_index 都是空的
    # )
    # max_node_id_test = max(
    #     (data.edge_index.max().item() for data in test_dataset if data.edge_index.numel() > 0),
    #     default=-1  # 默认值，如果所有的 edge_index 都是空的
    # )


    # print('Maximum node ID in train dataset:', max_node_id_train)
    # print('Maximum node ID in validation dataset:', max_node_id_val)
    # print('Maximum node ID in test dataset:', max_node_id_test)



    # 整合节点属性
    # Assuming emb and data.x are defined earlier in the script
    # # Check if emb is an instance of Embedding and retrieve the embedding weights
    # if isinstance(emb, torch.nn.Embedding):
    #     emb = emb.weight  # Get the embedding weights, which are a Tensor

    t1 = time.time()
    # Create a list to store tensors that need to be concatenated
    tensors_to_combine = []

    # Check if emb is not None, and if not, add it to the concatenation list
    if emb is not None:
        emb = emb.to(device)  # Move emb to the appropriate device
        tensors_to_combine.append(emb)

    # Ensure data.x is also on the correct device, and add it to the concatenation list
    if data.x is not None:
        data_x = data.x.to(device)
        tensors_to_combine.append(data_x)

    # Handle attributes if args.use_attribute is True and attributes exist
    if args.use_attribute and attributes is not None:
        attributes = attributes.to(device)
        tensors_to_combine.append(attributes)

    # Concatenate all valid tensors into node_information
    if tensors_to_combine:
        node_information = torch.cat(tensors_to_combine, dim=1)
    else:
        # If no valid tensors are available to concatenate, set a default value or raise an error
        node_information = None  # Or use an appropriate default tensor


    t2 = time.time()
    print(f"Time taken to concatenate tensors: {t2 - t1:.4f} seconds")
    print("前三行 emb:\n", emb[:3])
    print("前三行 data_x:\n", data_x[:3])
    print("前三行 node_information:\n", node_information[:3])
    print("emb 的尺寸:", emb.size())
    print("data_x 的尺寸:", data_x.size())
    print("node_information 的尺寸:", node_information.size())

    t3 = time.time()
    # 假设 emb 是你已有的张量，维度为 [num_nodes, embedding_dim]
    num_nodes, embedding_dim = node_information.shape

    # 创建一个 Embedding 对象，初始化为随机值
    emb = Embedding(num_embeddings=num_nodes, embedding_dim=embedding_dim)


    # 将已有的张量权重复制到新创建的嵌入层中
    emb.weight.data.copy_(node_information)



    # 如果你不希望在训练中更新这些权重
    # node_embedding.weight.requires_grad = False


    if 'edge_index' in data:
        max_node_id = data.edge_index.max().item()  # 获取最大节点 ID
    else:
        max_node_id = -1  # 如果没有边信息，则设置为 -1

    # 假设已经有了一个节点嵌入层 emb
    num_embeddings = emb.weight.size(0)  # 获取嵌入层的节点数

    t4 = time.time()
    print(f"Time taken to create and initialize Embedding: {t4 - t3:.4f} seconds")

    print(f"Node ID max: {max_node_id}, Node Embedding Size: {num_embeddings}")

    print("Creating DGCNN model with the following parameters:")
    print("Hidden channels:", args.hidden_channels)
    print("Number of layers:", args.num_layers)
    print("max_z:", max_z)
    print("SortPooling k:", args.sortpool_k)
    print("Dynamic training enabled:", args.dynamic_train)
    print("Use raw node features:", args.use_feature)
    print("Node embeddings dimension (if any):", emb.embedding_dim if emb is not None else "None")

    print(f"Embedding shape: {emb.weight.size()}, Data.x shape: {data.x.size()}")


    def print_model_info(model):
        print("Model Structure:")
        print(model)
        print("\nParameters and Sizes:")
        for name, param in model.named_parameters():
            print(f"{name}: {param.size()}")



    for run in range(args.runs):


        # 打印 train_dataset 信息
        print(f"Dataset type: {type(train_dataset)}")
        print(f"Dataset length: {len(train_dataset)}")

        # 检查单个数据点的详细信息
        # sample_data = train_dataset[0]
        # print(f"Sample data x shape: {sample_data.x.shape if sample_data.x is not None else 'None'}")
        # print(f"Sample data edge_index shape: {sample_data.edge_index.shape if sample_data.edge_index is not None else 'None'}")
        # print(f"Sample data node_id shape: {sample_data.node_id.shape if hasattr(sample_data, 'node_id') else 'None'}")

        # 检查 num_features
        print(f"Number of node features (train_dataset.num_features): {train_dataset.num_features}")


        if args.model == 'DGCNN':
            if args.finetune:
                model = DGCNN_finetune(args.hidden_channels, args.num_layers, max_z, args.sortpool_k, 
                            train_dataset, args.dynamic_train, use_feature=args.use_feature, 
                            node_embedding=emb).to(device)
            else:
                model = DGCNN(args.hidden_channels, args.num_layers, max_z, args.sortpool_k, 
                            train_dataset, args.dynamic_train, use_feature=args.use_feature, 
                            node_embedding=emb).to(device)


        elif args.model == 'SAGE':
            model = SAGE(args.hidden_channels, args.num_layers, max_z, train_dataset,  
                        args.use_feature, node_embedding=emb).to(device)
        elif args.model == 'GCN':
            model = GCN(args.hidden_channels, args.num_layers, max_z, train_dataset, 
                        args.use_feature, node_embedding=emb).to(device)
        elif args.model == 'GIN':
            model = GIN(args.hidden_channels, args.num_layers, max_z, train_dataset, 
                        args.use_feature, node_embedding=emb).to(device)
        
        # model = torch.compile(model, backend="eager")
        print_model_info(model)

        # Freeze model parameters for fine-tuning
        if args.finetune:
            for param in model.parameters():
                param.requires_grad = False

            for param in model.lin1.parameters():
                param.requires_grad = True

            for param in model.lin2.parameters():
                param.requires_grad = True



            trainable_params = filter(lambda p: p.requires_grad, model.parameters())
            parameters = list(trainable_params)
            optimizer = torch.optim.Adam(filter(lambda p: p.requires_grad, model.parameters()), lr=args.lr)
        else:
            parameters = list(model.parameters())


            # Ensure embedding parameters are not added to optimizer when frozen
            if args.train_node_embedding and not args.finetune:
                torch.nn.init.xavier_uniform_(emb.weight)
                parameters += list(emb.parameters())
        
            optimizer = torch.optim.Adam(params=parameters, lr=args.lr)

        # Calculate total parameters
        total_params = sum(p.numel() for p in parameters)
        print(f'Total number of parameters is {total_params}')
        if args.model == 'DGCNN':
            print(f'SortPooling k is set to {model.k}')
        with open(log_file, 'a') as f:
            print(f'Total number of parameters is {total_params}', file=f)
            if args.model == 'DGCNN':
                print(f'SortPooling k is set to {model.k}', file=f)

        
        for name, param in model.named_parameters():
            print(f"{name} - requires_grad: {param.requires_grad}")
        if emb is not None:
            print(f"Embedding requires_grad: {emb.weight.requires_grad}")



        start_epoch = 1
        if args.continue_from is not None:
            if args.resume_dir is not None:
                # 使用 resume_dir 来加载 checkpoint
                checkpoint_dir = args.resume_dir
            else:
                # 使用当前结果保存目录加载 checkpoint
                checkpoint_dir = args.res_dir
            model.load_state_dict(
                torch.load(os.path.join(checkpoint_dir, 
                    'run{}_model_checkpoint{}.pth'.format(run+1, args.continue_from)))
            )

            # 尝试加载优化器状态
            try:
                optimizer.load_state_dict(
                    torch.load(os.path.join(checkpoint_dir, 
                        'run{}_optimizer_checkpoint{}.pth'.format(run+1, args.continue_from)))
                )
            except ValueError as e:
                print(f"Optimizer state_dict loading failed: {e}")
                print("Reinitializing optimizer...")
                optimizer = torch.optim.Adam(filter(lambda p: p.requires_grad, model.parameters()), lr=args.lr)



            start_epoch = args.continue_from + 1
            args.epochs -= args.continue_from
        
        if args.only_test:
            results = test(model, val_loader, test_loader, device, args, emb, evaluator)
            for key, result in results.items():
                loggers[key].add_result(run, result)
            for key, result in results.items():
                valid_res, test_res = result
                print(key)
                print(f'Run: {run + 1:02d}, '
                    f'Valid: {100 * valid_res:.2f}%, '
                    f'Test: {100 * test_res:.2f}%')
            pdb.set_trace()
            exit()



        if args.only_pred:
            save_path = os.path.join(args.res_dir, 'alldata_predictions.h5')
            results = predict_and_save(model, full_loader, device, save_path, args, emb, evaluator, id_to_protein_mapping)
            print(f"Saved to {save_path}")
            pdb.set_trace()
            exit()


        if args.only_pred_finetunenodes:
            # **Step 4: 运行 `test()` 进行预测，并计算评估指标**
            
            # results = test(model, ttst_test_loader, ttst_test_loader, device, args, emb, evaluator)
            save_path = os.path.join(args.res_dir, f'{pred_req_file_name}_interested_predictions.csv')


            predict_and_save_filtered(
                model=model, 
                data_loader=full_loader, 
                device=device, 
                save_path=save_path,  # 只包含正样本边的预测
                args=args, 
                emb=emb, 
                id_to_protein_mapping=id_to_protein_mapping,
            )


            exit()


            # # 运行预测
            # device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            # predictions = predict_edges(model, test_loader, device)

            # # 存储预测结果
            # positive_edges["prediction"] = predictions[:len(positive_edges)]
            # negative_edges["prediction"] = predictions[len(positive_edges):]

            # # 保存结果
            # positive_edges.to_csv("filtered_positive_predictions.csv", index=False)
            # negative_edges.to_csv("filtered_negative_predictions.csv", index=False)

            # print("预测结果已保存！")
            pdb.set_trace()
            exit()





        if args.test_multiple_models:
            # 在这里填写你要加载的预训练模型的路径
            model_paths = [
                # 'path/to/your/model1.pth',
                # 'path/to/your/model2.pth',
            ]
            
            models = []
            for path in model_paths:
                m = cp.deepcopy(model)
                m.load_state_dict(torch.load(path, map_location=device))
                models.append(m)
            
            # 使用所有模型进行测试
            Results = test_multiple_models(models, val_loader, test_loader, device, args, emb, evaluator)

            # 遍历每个模型的测试结果
            for i, path in enumerate(model_paths):
                print(f"Results for model: {path}")
                with open(log_file, 'a') as f:
                    print(f"Results for model: {path}", file=f)
                
                results = Results[i]

                # 为每个评估指标记录结果
                for key, result in results.items():
                    loggers[key].add_result(run, result)

                # 打印每个评估指标的结果
                for key, result in results.items():
                    if isinstance(result, tuple):
                        valid_res, test_res = result
                        to_print = (f'Run: {run + 1:02d}, '
                                    f'Valid: {100 * valid_res:.2f}%, '
                                    f'Test: {100 * test_res:.2f}%')
                    else:  # 针对没有验证集的指标，例如 FDR
                        to_print = (f'Run: {run + 1:02d}, '
                                    f'Test: {100 * result:.2f}%')
                    
                    print(key)
                    print(to_print)
                    with open(log_file, 'a') as f:
                        print(key, file=f)
                        print(to_print, file=f)
            pdb.set_trace()
            exit()

        # Training starts
        print('Training epoch starts')
        for epoch in range(start_epoch, start_epoch + args.epochs):

            # print('epoch, start_epoch, epoch == start_epoch', epoch, start_epoch, epoch == start_epoch)
            if epoch == start_epoch:
                args.epoch = epoch - 1
                results = test(model, val_loader, test_loader, device, args, emb, evaluator)
                for key, result in results.items():
                    loggers[key].add_result(run, result)
                for key, result in results.items():
                    valid_res, test_res = result
                    print(key)
                    print(f'Run: {run + 1:02d}, '
                        f'Valid: {100 * valid_res:.2f}%, '
                        f'Test: {100 * test_res:.2f}%')


            args.epoch = epoch


            # 遍历所有子数据集
            for sub_idx, subdataset in enumerate(train_subdatasets):
                print(f" epoch {epoch}  Training on subdataset {sub_idx + 1}/{len(train_subdatasets)}")


                # 创建 DataLoader
                train_loader = DataLoader(subdataset,  batch_size=args.batch_size,
                        shuffle=True, num_workers=args.num_workers, pin_memory=True,  prefetch_factor=4 ) # pin_memory=True, # prefetch_factor=4)


                print("\nChecking first 5 batches in train_loader:")
                for batch_idx, data in enumerate(train_loader):
                    y_batch = data.y.cpu().numpy()
                    class_counts = Counter(y_batch)
                    
                    print(f"Batch {batch_idx + 1}: Label distribution: {class_counts}")
                    
                    if batch_idx == 4:  # 只打印前10个 batch
                        break


                # 检查每个批次的形状
                # for batch_idx, batch in enumerate(train_loader):
                #     print(f"  Batch {batch_idx + 1}: x shape = {batch.x.shape}, edge_index shape = {batch.edge_index.shape}")


                # 训练当前子数据集
                loss = train(model, optimizer, subdataset, train_loader, device, args, emb)
                print(f"    Subdataset {sub_idx + 1} Loss: {loss:.4f}")




            if epoch % args.eval_steps == 0 or epoch == start_epoch:
                results = test(model, val_loader, test_loader, device, args, emb, evaluator)
                for key, result in results.items():
                    loggers[key].add_result(run, result)

                if epoch % args.log_steps == 0:
                    model_name = os.path.join(
                        args.res_dir, 'run{}_model_checkpoint{}.pth'.format(run+1, epoch))
                    optimizer_name = os.path.join(
                        args.res_dir, 'run{}_optimizer_checkpoint{}.pth'.format(run+1, epoch))
                    torch.save(model.state_dict(), model_name)
                    torch.save(optimizer.state_dict(), optimizer_name)

                    for key, result in results.items():
                        valid_res, test_res = result
                        to_print = (f'Run: {run + 1:02d}, Epoch: {epoch:02d}, ' +
                                    f'Loss: {loss:.4f}, Valid: {100 * valid_res:.2f}%, ' +
                                    f'Test: {100 * test_res:.2f}%')
                        print(key)
                        print(to_print)
                        with open(log_file, 'a') as f:
                            print(key, file=f)
                            print(to_print, file=f)

        for key in loggers.keys():
            print(key)
            loggers[key].print_statistics(run)
            with open(log_file, 'a') as f:
                print(key, file=f)
                loggers[key].print_statistics(run, f=f)

    for key in loggers.keys():
        print(key)
        loggers[key].print_statistics()
        with open(log_file, 'a') as f:
            print(key, file=f)
            loggers[key].print_statistics(f=f)
    print(f'Total number of parameters is {total_params}')
    print(f'Results are saved in {args.res_dir}')




if __name__ == '__main__':
    # multiprocessing.freeze_support()

    main()

# %%


