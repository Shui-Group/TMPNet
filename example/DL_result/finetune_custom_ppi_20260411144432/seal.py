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

import scipy.sparse as ssp
from torch.utils.tensorboard import SummaryWriter
import numpy as np
import networkx as nx
from sklearn.metrics import roc_auc_score
import scipy.sparse as ssp
from scipy.sparse.csgraph import shortest_path
import torch
from torch.nn import BCEWithLogitsLoss, Embedding
import torch.nn.functional as F
from torch.utils.data import DataLoader
from torch.utils.data import random_split
from torch.utils.data import Subset
from sklearn.metrics import (
    roc_auc_score, precision_score,
    recall_score, f1_score
)
from collections import Counter

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

from utils import *
from models_ESM_3B import *
from custom_dataset import *
import pickle
import h5py
import pickle

os.environ['CUDA_LAUNCH_BLOCKING'] = '1'
torch.backends.cudnn.benchmark = True

import warnings


warnings.filterwarnings("ignore", message="An output with one or more elements was resized")
warnings.filterwarnings("ignore", category=UserWarning, module="torch_geometric")


class SEALDynamicDataset(Dataset):
    def __init__(self, root, data, split_edge, num_hops, percent=100, split='train', 
                 use_coalesce=False, node_label='drnl', ratio_per_hop=1.0, 
                 max_nodes_per_hop=None, directed=False, force_recompute=False, 
                 split_type='train', **kwargs):
        """
        初始化数据集，设置参数，检查并创建缓存目录。
        """
        self.data = data
        self.split_edge = split_edge
        self.num_hops = num_hops
        self.percent = percent
        self.use_coalesce = use_coalesce
        self.node_label = node_label
        self.ratio_per_hop = ratio_per_hop
        self.max_nodes_per_hop = max_nodes_per_hop
        self.directed = directed
        self.split_type = split_type

        # 设置缓存目录路径
        self.cache_dir = os.path.join('/data02/luoht/seal_ppi', "TEMP", split_type)
        os.makedirs(self.cache_dir, exist_ok=True)

        self.json_index_path = os.path.join(self.cache_dir, "index.json")
        self.records_per_file = 80000

        super(SEALDynamicDataset, self).__init__(root)

        if force_recompute:
            self._clear_existing_cache()

        self.links, self.labels = self._get_pos_neg_edges(split)
        self._log_label_distribution()

        if self.use_coalesce:
            self._coalesce_edges()

        self.A, self.A_csc = self._initialize_adjacency_matrix()

        # 添加稀疏性检查
        self._check_sparsity()

    def _clear_existing_cache(self):
        """
        如果强制重新生成缓存，则删除现有缓存文件。
        """
        print(f"Removing existing cache files and index in {self.cache_dir}")
        for file in os.listdir(self.cache_dir):
            if file.startswith(self.split_type):
                os.remove(os.path.join(self.cache_dir, file))

    def _get_pos_neg_edges(self, split):
        """
        获取正负样本边。
        """
        pos_edge, neg_edge = get_pos_neg_edges(split, self.split_edge, 
                                               self.data.edge_index, self.data.num_nodes, 
                                               self.percent, pos_neg_ratio=1/3)
        links = torch.cat([pos_edge, neg_edge], 1).t().tolist()
        labels = [1] * pos_edge.size(1) + [0] * neg_edge.size(1)
        return links, labels

    def _log_label_distribution(self):
        """
        输出标签分布。
        """
        label_counter = Counter(self.labels)
        print(f"fff Label distribution: {label_counter}")

    def _coalesce_edges(self):
        """
        压缩多重边到边权重。
        """
        self.data.edge_index, self.data.edge_weight = coalesce(
            self.data.edge_index, self.data.edge_weight, 
            self.data.num_nodes, self.data.num_nodes
        )

    def _initialize_adjacency_matrix(self):
        """
        初始化邻接矩阵，并返回稀疏矩阵及其转置。
        """
        edge_weight = self.data.edge_weight.view(-1) if 'edge_weight' in self.data else torch.ones(self.data.edge_index.size(1), dtype=int)
        #A = ssp((edge_weight, (self.data.edge_index[0], self.data.edge_index[1])), shape=(self.data.num_nodes, self.data.num_nodes))
        A = ssp.csr_matrix((edge_weight, (self.data.edge_index[0], self.data.edge_index[1])), shape=(self.data.num_nodes, self.data.num_nodes))
        A_csc = A.tocsc() if self.directed else None
        return A, A_csc

    def _check_sparsity(self):
        """
        检查图的稀疏性并输出相关信息。
        """
        total_elements = self.A.shape[0] * self.A.shape[1]
        nonzero_count = self.A.nnz
        sparsity = 1 - (nonzero_count / total_elements)

        print(f"Graph Sparsity: {sparsity:.2%}")
        print(f"Graph is {'Sparse' if sparsity > 0.9 else 'Dense'}")
        print(f"Non-zero elements: {nonzero_count}, Total elements: {total_elements}")

    def _compute_k_hop_sparse(self, src, dst):
        """
        使用稀疏矩阵计算 k-hop 子图。
        """
        init_nodes = {src, dst}
        mask = np.zeros(self.A.shape[0], dtype=bool)
        mask[list(init_nodes)] = True

        adjacency_power = self.A
        for _ in range(self.num_hops):
            new_mask = adjacency_power.dot(mask)
            mask = np.logical_or(mask, new_mask)

        subgraph_nodes = np.where(mask)[0]
        subgraph = self.A[subgraph_nodes, :][:, subgraph_nodes]
        z = self._drnl_node_labeling(subgraph_nodes, src, dst)

        return subgraph, subgraph_nodes, z

    def _drnl_node_labeling(self, subgraph_nodes, src, dst):
        """
        计算节点标签。
        """
        try:
            subgraph_sparse = self.A[subgraph_nodes, :][:, subgraph_nodes]
            src_idx = subgraph_nodes.tolist().index(src)
            dst_idx = subgraph_nodes.tolist().index(dst)

            distances_src = shortest_path(subgraph_sparse, directed=False, unweighted=True, indices=src_idx)
            distances_dst = shortest_path(subgraph_sparse, directed=False, unweighted=True, indices=dst_idx)

            z = 1 + np.minimum(distances_src, distances_dst).astype(int)
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
        if not os.path.exists(self.json_index_path):
            return -1

        with open(self.json_index_path, "r") as f:
            index = json.load(f)
            return max(map(int, index.keys())) if index else -1

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

        src, dst = self.links[idx]
        y = self.labels[idx]
        subgraph, subgraph_nodes, z = self._compute_k_hop_sparse(src, dst)

        if len(subgraph_nodes) == 0:
            raise ValueError(f"Empty subgraph at index {idx} with src={src}, dst={dst}")

        x = self.data.x[subgraph_nodes]
        rows, cols = subgraph.nonzero()
        edge_index = torch.tensor([rows, cols], dtype=torch.long)
        z = torch.tensor(z, dtype=torch.long)

        return Data(x=x, edge_index=edge_index, target_edge=torch.tensor([[src], [dst]]).t(), 
                    y=torch.tensor([y], dtype=torch.long), node_id=torch.tensor(subgraph_nodes, dtype=torch.long), z=z)

    def _check_label_distribution(self, labels):
        """
        统计标签的分布。
        """
        if not hasattr(self, 'label_counter'):
            self.label_counter = Counter()
        self.label_counter.update(labels)
        print(f"Current label distribution: {self.label_counter}")


class SEALDynamicDataset_finetune(SEALDynamicDataset):
    def __init__(self, root, data, data_graph, split_edge, split_edge_graph, num_hops, percent=100, 
                 split='train', use_coalesce=False, node_label='drnl', ratio_per_hop=1.0, 
                 max_nodes_per_hop=None, directed=False, force_recompute=False, split_type='train', **kwargs):
        """
        初始化微调数据集，继承自 SEALDynamicDataset。
        
        参数说明：
        - root: 数据根路径
        - data: 图数据（包含边集、节点等）
        - data_graph: 训练图
        - split_edge: 边的拆分字典
        - split_edge_graph: 拆分后的图结构
        - num_hops: 跳数
        - percent: 采样比例
        - split: 数据集划分（train, valid, test, all）
        - use_coalesce: 是否合并节点特征
        - node_label: 节点标签类型
        - ratio_per_hop: 每跳的比例
        - max_nodes_per_hop: 每跳的最大节点数
        - directed: 是否是有向图
        - force_recompute: 是否强制重新计算
        - split_type: 数据集类型（train/valid/test）
        """
        super(SEALDynamicDataset_finetune, self).__init__(root=root, data=data, split_edge=split_edge, 
                                                         num_hops=num_hops, split=split, **kwargs)
        
        # 覆盖父类参数
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

        # 设置缓存目录
        self.cache_dir = os.path.join('/data02/luoht/seal_ppi/TEMP_finetune', split_type)
        os.makedirs(self.cache_dir, exist_ok=True)

        self.json_index_path = os.path.join(self.cache_dir, "index.json")
        self.split_type = split_type
        self.records_per_file = 80000  # 每个 HDF5 文件存储 8 万条记录

        # 根据 split 参数设置边列表和标签
        if split == 'all':  # 推理阶段，直接使用预测边
            pred_edges = self.split_edge['all']['edge']
            self.links = pred_edges.t().tolist()  # 转换为 (src, dst) 列表
            self.labels = [1] * pred_edges.size(1)  # 假设所有预测边标签为1
        else:  # 训练/验证/测试阶段使用正负边
            pos_edge, neg_edge = get_pos_neg_edges(split, self.split_edge, 
                                                    self.data.edge_index, 
                                                    self.data.num_nodes, 
                                                    self.percent, pos_neg_ratio=1/9)
            self.links = torch.cat([pos_edge, neg_edge], 1).t().tolist()
            self.labels = [1] * pos_edge.size(1) + [0] * neg_edge.size(1)

        print(f"[Fine-tune {split}] Label distribution: {Counter(self.labels)}")

        # 构建邻接矩阵 A
        self._construct_adj_matrix(split)

        # 输出标签分布
        label_counter = Counter(self.labels)
        print(f"hhh_Label distribution: {label_counter}")

        # 检查稀疏性
        self._check_sparsity()

    def _construct_adj_matrix(self, split):
        """
        构建邻接矩阵 A，使用图数据或拆分后的数据集。
        根据 split 参数选择训练数据或验证/测试数据。
        """
        if split == "train" or split == "all":
            edge_weight = self._get_edge_weights(self.split_edge_graph[split])
            self.A = ssp.csr_matrix(
                (edge_weight, (self.split_edge_graph[split]['edge'][0], self.split_edge_graph[split]['edge'][1])),
                shape=(self.data_graph.num_nodes, self.data_graph.num_nodes)
            )
            self.A_csc = self.A.tocsc() if self.directed else None
        else:
            edge_weight = self._get_edge_weights(self.split_edge[split])
            self.A = ssp.csr_matrix(
                (edge_weight, (self.split_edge[split]['edge'][0], self.split_edge[split]['edge'][1])),
                shape=(self.data.num_nodes, self.data.num_nodes)
            )
            self.A_csc = self.A.tocsc() if self.directed else None

    def _get_edge_weights(self, edge_data):
        """
        获取边的权重。如果图数据中没有定义边权重，则返回默认值（1）。
        """
        if 'edge_weight' in edge_data:
            return edge_data.edge_weight.view(-1)
        else:
            return torch.ones(edge_data['edge'].size(1), dtype=int)

    def _check_sparsity(self):
        """
        检查邻接矩阵的稀疏性。
        """
        density = self.A.nnz / (self.A.shape[0] * self.A.shape[1])
        print(f"Adjacency matrix density: {density:.4f}")


#试一试动态加权

def focal_loss(logits, targets, alpha=0.9, gamma=2.0, reduction='mean'):
    prob = torch.sigmoid(logits)
    targets = targets.float()
    
    pt = torch.where(targets == 1, prob, 1 - prob)
    alpha_t = torch.where(targets == 1, alpha, 1 - alpha)
    
    loss = - alpha_t * (1 - pt) ** gamma * torch.log(pt + 1e-8)
    
    return loss.mean() if reduction == 'mean' else loss.sum()


def train(model, optimizer, train_dataset, train_loader, device, args, emb=None):
    model.train()
    y_pred, y_true = [], []
    total_loss = 0
    pbar = tqdm(train_loader, ncols=80)

    for step, data in enumerate(pbar):
        data = data.to(device)
        optimizer.zero_grad()

        x = data.x if args.use_feature else None
        edge_weight = data.edge_weight if args.use_edge_weight else None
        node_id = data.node_id if emb else None

        logits = model(data.z, data.edge_index, data.batch, x, edge_weight, node_id).view(-1)
        labels = data.y.view(-1).to(torch.float)

        # === Focal Loss ===
        loss = focal_loss(logits, labels, alpha=0.25, gamma=2.0)

        loss.backward()
        optimizer.step()
        total_loss += loss.item() * data.num_graphs

        y_pred.append(logits.detach().cpu())
        y_true.append(labels.cpu())

        # === 打印统计信息 ===
        counts = Counter(labels.cpu().numpy())
        num_pos = counts.get(1.0, 0)
        num_neg = counts.get(0.0, 0)

        #print(f"\n[Batch {step + 1}]  Positive: {num_pos}, Negative: {num_neg}")
        print(f"→ Focal Loss: {loss.item():.4f}")

        pbar.set_description(f"Loss: {loss.item():.4f}")

    avg_loss = total_loss / len(train_dataset)

    y_pred = torch.cat(y_pred).sigmoid()
    y_true = torch.cat(y_true)

    print("\nFinal Train Label Distribution:", Counter(y_true.numpy()))

    # === 评估指标 ===
    results = {}
    for metric in args.eval_metrics:
        if metric == 'auc':
            results.update(evaluate_auc(y_pred, y_true, y_pred, y_true))
        elif metric == 'precision':
            results.update(evaluate_precision(y_pred, y_true, y_pred, y_true, threshold=0.5))
        elif metric == 'recall':
            results.update(evaluate_recall(y_pred, y_true, y_pred, y_true, threshold=0.5))
        elif metric == 'f1':
            results.update(evaluate_f1(y_pred, y_true, y_pred, y_true, threshold=0.5))

    print(f"Train Loss: {avg_loss:.4f}")
    for key, value in results.items():
        print(f"Train {key}: {value}")
    return avg_loss



#根据pos：neg数量进行加权

'''
def train(model, optimizer, train_dataset, train_loader, device, args, emb=None):
    model.train()
    y_pred, y_true = [], []
    total_loss = 0
    pbar = tqdm(train_loader, ncols=80)

    for step, data in enumerate(pbar):
        data = data.to(device)
        optimizer.zero_grad()

        x = data.x if args.use_feature else None
        edge_weight = data.edge_weight if args.use_edge_weight else None
        node_id = data.node_id if emb else None

        logits = model(data.z, data.edge_index, data.batch, x, edge_weight, node_id).view(-1)
        labels = data.y.view(-1).to(torch.float)

        # === 统计类别数量 ===
        counts = Counter(labels.cpu().numpy())
        num_pos = counts.get(1.0, 0)
        num_neg = counts.get(0.0, 0)
        n = num_pos + num_neg

        # === 加权损失 ===
        if num_pos == 0 or num_neg == 0:
            loss = BCEWithLogitsLoss()(logits, labels)
            pos_weight_val = neg_weight_val = None  # 不计算无效权重
        else:
            pos_weight_val = n / (2 * num_pos)
            neg_weight_val = n / (2 * num_neg)
            weights = torch.where(labels == 1.0,
                                  torch.full_like(labels, pos_weight_val),
                                  torch.full_like(labels, neg_weight_val))
            loss = F.binary_cross_entropy_with_logits(logits, labels, weight=weights, reduction='mean')

        loss.backward()
        optimizer.step()
        total_loss += loss.item() * data.num_graphs

        y_pred.append(logits.detach().cpu())
        y_true.append(labels.cpu())

        # === 打印信息 ===
        print(f"\n[Batch {step + 1}]  Positive: {num_pos}, Negative: {num_neg}")
        if pos_weight_val is not None:
            print(f"→ Pos sample weight: {pos_weight_val:.4f}, Neg sample weight: {neg_weight_val:.4f}")
        else:
            print("→ Skip weighting (only one class present in this batch)")

        pbar.set_description(f"Loss: {loss.item():.4f}")

    avg_loss = total_loss / len(train_dataset)

    y_pred = torch.cat(y_pred).sigmoid()
    y_true = torch.cat(y_true)

    print("\nFinal Train Label Distribution:", Counter(y_true.numpy()))

    # 计算各种评估指标（和 test 逻辑一致）
    results = {}
    for metric in args.eval_metrics:
        if metric == 'auc':
            results.update(evaluate_auc(y_pred, y_true, y_pred, y_true))
        elif metric == 'precision':
            results.update(evaluate_precision(y_pred, y_true, y_pred, y_true,threshold=0.5))
        elif metric == 'recall':
            results.update(evaluate_recall(y_pred, y_true, y_pred, y_true,threshold=0.5))
        elif metric == 'f1':
            results.update(evaluate_f1(y_pred, y_true, y_pred, y_true,threshold=0.5))

    print(f"Train Loss: {avg_loss:.4f}")
    for key, value in results.items():
        print(f"Train {key}: {value}")
    return avg_loss
'''

#原始的BCE
'''
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
            results.update(evaluate_precision(y_pred, y_true, y_pred, y_true,threshold=0.5))
        elif metric == 'recall':
            results.update(evaluate_recall(y_pred, y_true, y_pred, y_true,threshold=0.5))
        elif metric == 'f1':
            results.update(evaluate_f1(y_pred, y_true, y_pred, y_true,threshold=0.5))

    print(f"Train Loss: {avg_loss:.4f}")
    for key, value in results.items():
        print(f"Train {key}: {value}")
    return avg_loss

'''
#------------------------test--------------------------
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
            results.update(evaluate_precision(val_pred, val_true, test_pred, test_true, threshold=0.5))
        elif metric == 'recall':
            results.update(evaluate_recall(val_pred, val_true, test_pred, test_true,threshold=0.5))
        elif metric == 'f1':
            results.update(evaluate_f1(val_pred, val_true, test_pred, test_true,threshold=0.5))
            

    return results

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

    # **计算并打印各种评估指标**
    results = {}
    for metric in args.eval_metrics:
        if metric == 'fdr':
            results.update(evaluate_fdr(test_pred, test_true, test_pred, test_true))
        elif metric == 'precision':
            results.update(evaluate_precision(test_pred, test_true, test_pred, test_true,threshold=0.5))
        elif metric == 'recall':
            results.update(evaluate_recall(test_pred, test_true, test_pred, test_true,threshold=0.5))
        elif metric == 'f1':
            results.update(evaluate_f1(test_pred, test_true, test_pred, test_true,threshold=0.5))
        elif metric == 'auc':
            results.update(evaluate_auc(test_pred, test_true, test_pred, test_true))
    # **打印评估结果**
    print("\nEvaluation Results:")
    for key, value in results.items():
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

    # === 保存结果 ===
    df = pd.DataFrame(predictions_list, columns=["Protein1", "Protein2", "Prediction"])
    df.to_csv(save_path, index=False)
    print(f"\n✅ 预测结果已保存至 {save_path}")

@torch.no_grad()
def predict_and_save_filtered_test(model, data_loader, device, save_path, args, emb, 
                             id_to_protein_mapping):
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

        # === 获取真实标签 ===
        labels = data.y.view(-1).cpu().numpy()

        # === 获取目标边的全局ID ===
        target_edge = data.target_edge.T
        src_global = target_edge[0].cpu().numpy().tolist()
        dst_global = target_edge[1].cpu().numpy().tolist()

        # === 转换到蛋白质名称 ===
        src_proteins = [id_to_protein_mapping.get(int(gid), f"UNK_{gid}") for gid in src_global]
        dst_proteins = [id_to_protein_mapping.get(int(gid), f"UNK_{gid}") for gid in dst_global]

        # === 存储结果 ===
        batch_predictions = list(zip(src_proteins, dst_proteins, labels, probabilities))
        predictions_list.extend(batch_predictions)

    # === 保存结果 ===
    df = pd.DataFrame(predictions_list, columns=["Protein1", "Protein2", "Label", "Prediction"])
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

def evaluate_precision(val_pred, val_true, test_pred, test_true, threshold=0.5):
    # 计算 AUC（直接用概率）
    valid_auc = roc_auc_score(val_true, val_pred)
    test_auc = roc_auc_score(test_true, test_pred)

    # 二值化预测（用于计算 Precision, Recall, F1）
    val_pred_label = (val_pred >= threshold).int()
    test_pred_label = (test_pred >= threshold).int()

    # 计算 Precision, Recall, F1
    valid_precision = precision_score(val_true, val_pred_label)
    test_precision = precision_score(test_true, test_pred_label)

    results = {
        'Precision': (valid_precision, test_precision)
    }

    return results


def evaluate_recall(val_pred, val_true, test_pred, test_true, threshold=0.5):
    # 将预测概率转为二值标签
    val_pred_label = (np.array(val_pred) >= threshold).astype(int)
    test_pred_label = (np.array(test_pred) >= threshold).astype(int)

    # 计算 recall
    valid_recall = recall_score(val_true, val_pred_label)
    test_recall = recall_score(test_true, test_pred_label)

    results = {}
    results['Recall'] = (valid_recall, test_recall)
    return results

def evaluate_f1(val_pred, val_true, test_pred, test_true, threshold=0.5):
    # 计算 AUC（直接用概率）
    valid_auc = roc_auc_score(val_true, val_pred)
    test_auc = roc_auc_score(test_true, test_pred)

    # 二值化预测（用于计算 Precision, Recall, F1）
    val_pred_label = (val_pred >= threshold).int()
    test_pred_label = (test_pred >= threshold).int()

    valid_f1 = f1_score(val_true, val_pred_label)
    test_f1 = f1_score(test_true, test_pred_label)

    results = {
        'F1-score': (valid_f1, test_f1)
    }

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

def evaluate_fdr_simple(val_pred, val_true, test_pred, test_true):
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

def evaluate_fdr(val_pred, val_true, test_pred, test_true, decoy_ratio=0.3):
   
    results = {}
    return evaluate_fdr_simple(val_pred, val_true, test_pred, test_true)


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
        copy('seal.py', args.res_dir)
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

        print('load origional data')
        dataset = load_localdata()
        id_to_protein_mapping = dataset.id_to_protein

        split_edge = dataset.get_edge_split()
        print("✅ Inspecting split_edge after get_edge_split():")
        for split in ['train', 'valid', 'test']:
            print(f"  {split} keys: {list(split_edge[split].keys())}")
            if 'edge_neg' in split_edge[split]:
                print(f"    🔹 edge_neg exists in {split}, size = {split_edge[split]['edge_neg'].size()}")
            else:
                print(f"    ⚠️ edge_neg missing in {split}")
 
        data = dataset[0]
        train_graph_data = dataset.train_dataset

       
    if args.only_pred_finetunenodes:  #  !!  for predictions 
        # with open(id_to_protein_mapping_file, "r") as f:
        #     id_to_protein_mapping = json.load(f)

        assert args.continue_from is not None, "continue_from should not be None"
        args.finetune = True
        


        if args.add_newexpression == True:
            #expression_data_file = "dataset/custom_ppi/raw_coexpress_data/DIO_chow-7T_1-10-20250320(1)_new_data.csv"
            #expression_data_file = "dataset/custom_ppi/raw_coexpress_data/DIO_chow-12T_1-10-20250320(1)_new_data.csv"
            #/media/luoht/新加卷/luoht/seal_ppi/dataset/custom_ppi/finetune_data/MT22/01.Expression_MT22-7T_1-10-20241206.csv
            expression_data_file = "dataset/custom_ppi/5_14_finetune_22T/raw_22T_exp.csv"
            #dataset/custom_ppi/finetune_data/MT22/DIANN1.8.1Re-Old.pg_matrix_processed_v3.csv
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
        #pred_req_file_name =  '4_22_pre_formatted'  #'DIO-chow_rawraw_pos-20250326_formatted' # 'TP for EXP of Glp1r'  # 'unknow_label_3_20' 
        pred_req_file_name ='20260325_AP_CF_PPI'  

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
        

    device = torch.device('cuda:0' if torch.cuda.is_available() else 'cpu')
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
                #pred_data, 
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
    #print("前三行 emb:\n", emb[:3])
    print("前三行 data_x:\n", data_x[:3])
    print("前三行 node_information:\n", node_information[:3])
    #print("emb 的尺寸:", emb.size())
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

            for param in model.conv1.parameters():
                param.requires_grad = True

            for param in model.conv2.parameters():
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
            print(f'sss----SortPooling k is set to {model.k}')
        with open(log_file, 'a') as f:
            print(f'Total number of parameters is {total_params}', file=f)
            if args.model == 'DGCNN':
                print(f'-----SortPooling k is set to {model.k}', file=f)

        
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
           
            '''
            checkpoint = torch.load(os.path.join(checkpoint_dir,
                'run{}_model_checkpoint{}.pth'.format(run+1, args.continue_from)))

            model.load_state_dict(checkpoint['model_state_dict'])
            k_pretrain = checkpoint.get('k', None)
            print(f"Loaded k from checkpoint: {k_pretrain}")
            '''
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
            #pdb.set_trace()
            save_path = os.path.join(args.res_dir, f'only_test.csv')
            predict_and_save_filtered_test(
                model=model,
                data_loader=test_loader, 
                device=device, 
                save_path=save_path,  # 只包含正样本边的预测
                args=args, 
                emb=emb, 
                id_to_protein_mapping=id_to_protein_mapping,
            )
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
        writer = SummaryWriter(log_dir=os.path.join(args.res_dir, f"tb_logs_run{run+1}"))
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
                    '''
                    torch.save({
                        'model_state_dict': model.state_dict(),
                        'k': model.k,
                    }, model_name)
                    '''
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
                        writer.add_scalar(f'{key}/Loss', loss, epoch)
                        writer.add_scalar(f'{key}/ValidAcc', valid_res * 100, epoch)
                        writer.add_scalar(f'{key}/TestAcc', test_res * 100, epoch)

        for key in loggers.keys():
            print(key)
            loggers[key].print_statistics(run)
            with open(log_file, 'a') as f:
                print(key, file=f)
                loggers[key].print_statistics(run, f=f)
    
    writer.close()
    
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