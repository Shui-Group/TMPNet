# Copyright (c) Facebook, Inc. and its affiliates.
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.
#%%
import sys
import math
from tqdm import tqdm
import random
import numpy as np
import scipy.sparse as ssp
from scipy.sparse.csgraph import shortest_path
import torch
from torch_sparse import spspmm
import torch_geometric
from torch_geometric.data import DataLoader
from torch_geometric.data import Data
from torch_geometric.utils import (negative_sampling, add_self_loops,
                                   train_test_split_edges, to_networkx)
from torch_geometric.data import Data, DataLoader, Batch
from torch.utils.data import IterableDataset
from torch.utils.data.dataloader import default_collate
# import dgl
from scipy import sparse

from time import time, perf_counter

import pdb

import os
import networkx as nx
cur_dir = os.path.dirname(os.path.realpath(__file__))
# sys.path.append('%s/software/node2vec/src' % cur_dir)
#from node2vec import Node2Vec
#from gensim.models import Word2Vec
import psutil
#from nodevectors import ProNE


#%%

def print_memory_usage(tag):
    process = psutil.Process(os.getpid())
    memory_in_mb = process.memory_info().rss / 1024**2  # 转换为 MB
    print(f"[{tag}] Memory usage: {memory_in_mb:.2f} MB")

def print_io_usage(tag):
    process = psutil.Process(os.getpid())
    io_counters = process.io_counters()
    print(f"[{tag}] IO Read: {io_counters.read_bytes / 1024**2:.2f} MB, IO Write: {io_counters.write_bytes / 1024**2:.2f} MB")



def neighbors(fringe, A, outgoing=True):
    # Find all 1-hop neighbors of nodes in fringe from graph A, 
    # where A is a scipy csr adjacency matrix.
    # If outgoing=True, find neighbors with outgoing edges;
    # otherwise, find neighbors with incoming edges (you should
    # provide a csc matrix in this case).
    if outgoing:
        res = set(A[list(fringe)].indices)
    else:
        res = set(A[:, list(fringe)].indices)

    return res


def k_hop_subgraph(src, dst, num_hops, A, sample_ratio=1.0, 
                   max_nodes_per_hop=None, node_features=None, 
                   y=1, directed=False, A_csc=None):
    # Extract the k-hop enclosing subgraph around link (src, dst) from A. 
    nodes = [src, dst]
    dists = [0, 0]
    visited = set([src, dst])
    fringe = set([src, dst])
    for dist in range(1, num_hops+1):
        if not directed:
            fringe = neighbors(fringe, A)
        else:
            out_neighbors = neighbors(fringe, A)
            in_neighbors = neighbors(fringe, A_csc, False)
            fringe = out_neighbors.union(in_neighbors)
        fringe = fringe - visited
        visited = visited.union(fringe)
        if sample_ratio < 1.0:
            fringe = random.sample(fringe, int(sample_ratio*len(fringe)))
        if max_nodes_per_hop is not None:
            if max_nodes_per_hop < len(fringe):
                fringe = random.sample(fringe, max_nodes_per_hop)
        if len(fringe) == 0:
            break
        nodes = nodes + list(fringe)
        dists = dists + [dist] * len(fringe)
    subgraph = A[nodes, :][:, nodes]

    # Remove target link between the subgraph.
    subgraph[0, 1] = 0
    subgraph[1, 0] = 0

    if node_features is not None:
        node_features = node_features[nodes]

    return nodes, subgraph, dists, node_features, y


def drnl_node_labeling(adj, src, dst):
    # Double Radius Node Labeling (DRNL).
    src, dst = (dst, src) if src > dst else (src, dst)

    idx = list(range(src)) + list(range(src + 1, adj.shape[0]))
    adj_wo_src = adj[idx, :][:, idx]

    idx = list(range(dst)) + list(range(dst + 1, adj.shape[0]))
    adj_wo_dst = adj[idx, :][:, idx]

    dist2src = shortest_path(adj_wo_dst, directed=False, unweighted=True, indices=src)
    dist2src = np.insert(dist2src, dst, 0, axis=0)
    dist2src = torch.from_numpy(dist2src)

    dist2dst = shortest_path(adj_wo_src, directed=False, unweighted=True, indices=dst-1)
    dist2dst = np.insert(dist2dst, src, 0, axis=0)
    dist2dst = torch.from_numpy(dist2dst)

    dist = dist2src + dist2dst
    # dist_over_2, dist_mod_2 = dist // 2, dist % 2
    dist_over_2, dist_mod_2 = torch.div(dist, 2, rounding_mode='trunc'), dist % 2


    z = 1 + torch.min(dist2src, dist2dst)
    z += dist_over_2 * (dist_over_2 + dist_mod_2 - 1)
    z[src] = 1.
    z[dst] = 1.
    z[torch.isnan(z)] = 0.

    return z.to(torch.long)


def de_node_labeling(adj, src, dst, max_dist=3):
    # Distance Encoding. See "Li et. al., Distance Encoding: Design Provably More 
    # Powerful Neural Networks for Graph Representation Learning."
    src, dst = (dst, src) if src > dst else (src, dst)

    dist = shortest_path(adj, directed=False, unweighted=True, indices=[src, dst])
    dist = torch.from_numpy(dist)

    dist[dist > max_dist] = max_dist
    dist[torch.isnan(dist)] = max_dist + 1

    return dist.to(torch.long).t()


def de_plus_node_labeling(adj, src, dst, max_dist=100):
    # Distance Encoding Plus. When computing distance to src, temporarily mask dst;
    # when computing distance to dst, temporarily mask src. Essentially the same as DRNL.
    src, dst = (dst, src) if src > dst else (src, dst)

    idx = list(range(src)) + list(range(src + 1, adj.shape[0]))
    adj_wo_src = adj[idx, :][:, idx]

    idx = list(range(dst)) + list(range(dst + 1, adj.shape[0]))
    adj_wo_dst = adj[idx, :][:, idx]

    dist2src = shortest_path(adj_wo_dst, directed=False, unweighted=True, indices=src)
    dist2src = np.insert(dist2src, dst, 0, axis=0)
    dist2src = torch.from_numpy(dist2src)

    dist2dst = shortest_path(adj_wo_src, directed=False, unweighted=True, indices=dst-1)
    dist2dst = np.insert(dist2dst, src, 0, axis=0)
    dist2dst = torch.from_numpy(dist2dst)

    dist = torch.cat([dist2src.view(-1, 1), dist2dst.view(-1, 1)], 1)
    dist[dist > max_dist] = max_dist
    dist[torch.isnan(dist)] = max_dist + 1

    return dist.to(torch.long)


def construct_pyg_graph(node_ids, adj, dists, node_features, y, node_label='drnl'):
    # Construct a pytorch_geometric graph from a scipy csr adjacency matrix.
    u, v, r = ssp.find(adj)
    num_nodes = adj.shape[0]
    
    node_ids = torch.LongTensor(node_ids)
    u, v = torch.LongTensor(u), torch.LongTensor(v)
    r = torch.LongTensor(r)
    edge_index = torch.stack([u, v], 0)
    edge_weight = r.to(torch.float)
    y = torch.tensor([y])
    if node_label == 'drnl':  # DRNL
        z = drnl_node_labeling(adj, 0, 1)
    elif node_label == 'hop':  # mininum distance to src and dst
        z = torch.tensor(dists)
    elif node_label == 'zo':  # zero-one labeling trick
        z = (torch.tensor(dists)==0).to(torch.long)
    elif node_label == 'de':  # distance encoding
        z = de_node_labeling(adj, 0, 1)
    elif node_label == 'de+':
        z = de_plus_node_labeling(adj, 0, 1)
    elif node_label == 'degree':  # this is technically not a valid labeling trick
        z = torch.tensor(adj.sum(axis=0)).squeeze(0)
        z[z>100] = 100  # limit the maximum label to 100
    else:
        z = torch.zeros(len(dists), dtype=torch.long)
    data = Data(node_features, edge_index, edge_weight=edge_weight, y=y, z=z, 
                node_id=node_ids, num_nodes=num_nodes)
    return data

 
def extract_enclosing_subgraphs(link_index, A, x, y, num_hops, node_label='drnl', 
                                ratio_per_hop=1.0, max_nodes_per_hop=None, 
                                directed=False, A_csc=None):
    # Extract enclosing subgraphs from A for all links in link_index.
    data_list = []
    for src, dst in tqdm(link_index.t().tolist()):
        tmp = k_hop_subgraph(src, dst, num_hops, A, ratio_per_hop, 
                             max_nodes_per_hop, node_features=x, y=y, 
                             directed=directed, A_csc=A_csc)
        data = construct_pyg_graph(*tmp, node_label)
        data_list.append(data)

    return data_list


def do_edge_split(dataset, fast_split=False, val_ratio=0.05, test_ratio=0.1):
    data = dataset[0]
    random.seed(234)
    torch.manual_seed(234)

    if not fast_split:
        data = train_test_split_edges(data, val_ratio, test_ratio)
        edge_index, _ = add_self_loops(data.train_pos_edge_index)
        data.train_neg_edge_index = negative_sampling(
            edge_index, num_nodes=data.num_nodes,
            num_neg_samples=data.train_pos_edge_index.size(1))
    else:
        num_nodes = data.num_nodes
        row, col = data.edge_index
        # Return upper triangular portion.
        mask = row < col
        row, col = row[mask], col[mask]
        n_v = int(math.floor(val_ratio * row.size(0)))
        n_t = int(math.floor(test_ratio * row.size(0)))
        # Positive edges.
        perm = torch.randperm(row.size(0))
        row, col = row[perm], col[perm]
        r, c = row[:n_v], col[:n_v]
        data.val_pos_edge_index = torch.stack([r, c], dim=0)
        r, c = row[n_v:n_v + n_t], col[n_v:n_v + n_t]
        data.test_pos_edge_index = torch.stack([r, c], dim=0)
        r, c = row[n_v + n_t:], col[n_v + n_t:]
        data.train_pos_edge_index = torch.stack([r, c], dim=0)
        # Negative edges (cannot guarantee (i,j) and (j,i) won't both appear)
        neg_edge_index = negative_sampling(
            data.edge_index, num_nodes=num_nodes,
            num_neg_samples=row.size(0))
        data.val_neg_edge_index = neg_edge_index[:, :n_v]
        data.test_neg_edge_index = neg_edge_index[:, n_v:n_v + n_t]
        data.train_neg_edge_index = neg_edge_index[:, n_v + n_t:]

    split_edge = {'train': {}, 'valid': {}, 'test': {}}
    split_edge['train']['edge'] = data.train_pos_edge_index.t()
    split_edge['train']['edge_neg'] = data.train_neg_edge_index.t()
    split_edge['valid']['edge'] = data.val_pos_edge_index.t()
    split_edge['valid']['edge_neg'] = data.val_neg_edge_index.t()
    split_edge['test']['edge'] = data.test_pos_edge_index.t()
    split_edge['test']['edge_neg'] = data.test_neg_edge_index.t()
    return split_edge




def get_pos_neg_edges(split, split_edge, edge_index, num_nodes, percent=100, pos_neg_ratio = 1):
    print("=" * 60)
    print(f"[DEBUG] Entered get_pos_neg_edges for split = '{split}'")
    
    # 检查 split_edge 结构
    if split not in split_edge:
        print(f"[ERROR] split '{split}' not found in split_edge keys: {list(split_edge.keys())}")
        return None, None
    
    print(f"[DEBUG] Keys in split_edge[{split}]: {list(split_edge[split].keys())}")
    
    # 打印 edge_neg 的存在与否
    has_edge_neg = 'edge_neg' in split_edge[split]
    print(f"[DEBUG] 'edge_neg' in split_edge[{split}]? {has_edge_neg}")

    if has_edge_neg:
        print(f"[DEBUG] edge_neg type: {type(split_edge[split]['edge_neg'])}, shape: {split_edge[split]['edge_neg'].shape}")

    print("=" * 60)

    # print('keys', split_edge['train'].keys())

    if 'edge' in split_edge['train']:
        pos_edge = split_edge[split]['edge'].t()

        # 检查并确保正边的形状是 [2, num_edges]
        if pos_edge.size(1) == 2:
            pos_edge = pos_edge.t()  # 转置为  [2, num_edges]
        print(f"Positive edges for {split}: {pos_edge.size()}")

        if 'edge_neg' in split_edge[split]:
            print(f"[INFO] Using pre-sampled negative edges for split: {split}")
            # use presampled  negative training edges for ogbl-vessel
            neg_edge = split_edge[split]['edge_neg'].t()

            if neg_edge.size(1) == 2:
                neg_edge = neg_edge.t()

        else:
            print(f"[INFO] Generating negative edges dynamically for split: {split}")
            new_edge_index, _ = add_self_loops(edge_index)
            num_pos = pos_edge.size(1)
            num_neg = num_pos * 2 
            ''' 
            neg_edge = negative_sampling(
                new_edge_index, num_nodes=num_nodes,
                num_neg_samples=pos_edge.size(1))
            '''
            neg_edge = negative_sampling(
                new_edge_index, num_nodes=num_nodes,
                num_neg_samples=num_neg)

        print(f"Negative edges for {split}: {neg_edge.size()}")

        actual_ratio = pos_edge.size(1) / neg_edge.size(1)
        print(f'actual_ratio pos:neg= {actual_ratio}')


        # subsample for pos_edge
        # np.random.seed(142)
        num_pos = pos_edge.size(1)
        # print(f"Number of positive edges before sampling: {num_pos}")
        perm = np.random.permutation(num_pos)
        perm = perm[:int(percent / 100 * num_pos)]
        pos_edge = pos_edge[:, perm]
        # print(f"Number of positive edges after sampling: {pos_edge.size(1)}")
        # subsample for neg_edge

        # np.random.seed(142)
        num_neg = neg_edge.size(1)
        num_target_neg = int(percent / 100 * num_pos / pos_neg_ratio)
        #num_target_neg = int(percent / 100 * num_pos * pos_neg_ratio) 
        # target_neg = int(num_pos / pos_neg_ratio)
        # print(f"Number of negative edges before sampling: {num_neg}")
        perm = np.random.permutation(num_neg)
        perm = perm[:num_target_neg]
        # perm = perm[:int(percent / 100 * num_neg)]
        neg_edge = neg_edge[:, perm]
        # print(f"Number of negative edges after sampling: {neg_edge.size(1)}")


        actual_ratio2 =  pos_edge.size(1) / neg_edge.size(1)
        print(f'actual_ratio after process pos:neg= {actual_ratio2}')



    elif 'source_node' in split_edge['train']:
        source = split_edge[split]['source_node']
        target = split_edge[split]['target_node']
        if split == 'train':
            target_neg = torch.randint(0, num_nodes, [target.size(0), 1],
                                       dtype=torch.long)
        else:
            target_neg = split_edge[split]['target_node_neg']
        # subsample
        # np.random.seed(42)
        num_source = source.size(0)
        perm = np.random.permutation(num_source)
        perm = perm[:int(percent / 100 * num_source)]
        source, target, target_neg = source[perm], target[perm], target_neg[perm, :]
        pos_edge = torch.stack([source, target])
        neg_per_target = target_neg.size(1)
        neg_edge = torch.stack([source.repeat_interleave(neg_per_target), 
                                target_neg.view(-1)])
        
    return pos_edge, neg_edge  # [2, x]


def CN(A, edge_index, batch_size=100000):
    # The Common Neighbor heuristic score.
    link_loader = DataLoader(range(edge_index.size(1)), batch_size)
    scores = []
    for ind in tqdm(link_loader):
        src, dst = edge_index[0, ind], edge_index[1, ind]
        cur_scores = np.array(np.sum(A[src].multiply(A[dst]), 1)).flatten()
        scores.append(cur_scores)
    return torch.FloatTensor(np.concatenate(scores, 0)), edge_index


def AA(A, edge_index, batch_size=100000):
    # The Adamic-Adar heuristic score.
    multiplier = 1 / np.log(A.sum(axis=0))
    multiplier[np.isinf(multiplier)] = 0
    A_ = A.multiply(multiplier).tocsr()
    link_loader = DataLoader(range(edge_index.size(1)), batch_size)
    scores = []
    for ind in tqdm(link_loader):
        src, dst = edge_index[0, ind], edge_index[1, ind]
        cur_scores = np.array(np.sum(A[src].multiply(A_[dst]), 1)).flatten()
        scores.append(cur_scores)
    scores = np.concatenate(scores, 0)
    return torch.FloatTensor(scores), edge_index


def PPR(A, edge_index):
    # The Personalized PageRank heuristic score.
    # Need install fast_pagerank by "pip install fast-pagerank"
    # Too slow for large datasets now.
    from fast_pagerank import pagerank_power
    num_nodes = A.shape[0]
    src_index, sort_indices = torch.sort(edge_index[0])
    dst_index = edge_index[1, sort_indices]
    edge_index = torch.stack([src_index, dst_index])
    #edge_index = edge_index[:, :50]
    scores = []
    visited = set([])
    j = 0
    for i in tqdm(range(edge_index.shape[1])):
        if i < j:
            continue
        src = edge_index[0, i]
        personalize = np.zeros(num_nodes)
        personalize[src] = 1
        ppr = pagerank_power(A, p=0.85, personalize=personalize, tol=1e-7)
        j = i
        while edge_index[0, j] == src:
            j += 1
            if j == edge_index.shape[1]:
                break
        all_dst = edge_index[1, i:j]
        cur_scores = ppr[all_dst]
        if cur_scores.ndim == 0:
            cur_scores = np.expand_dims(cur_scores, 0)
        scores.append(np.array(cur_scores))

    scores = np.concatenate(scores, 0)
    return torch.FloatTensor(scores), edge_index


class Logger(object):
    def __init__(self, runs, info=None):
        self.info = info
        self.results = [[] for _ in range(runs)]

    def add_result(self, run, result):
        assert len(result) == 2
        assert run >= 0 and run < len(self.results)
        self.results[run].append(result)

    def print_statistics(self, run=None, f=sys.stdout):
        if run is not None:
            result = 100 * torch.tensor(self.results[run])
            print("Shape of result (run not None):", result.shape)  # 打印结果的形状以进行调试
            
            if result.numel() == 0:
                print(f'Run {run + 1:02d}:', file=f)
                print(f'Highest Valid: N/A', file=f)
                print(f'Highest Eval Point: N/A', file=f)
                print(f'   Final Test: N/A', file=f)
            else:
                if result.ndim == 1:
                    argmax = result.argmax().item()
                    highest_valid = result.max().item()
                    final_test = result[argmax].item()
                    highest_eval_point = argmax + 1
                else:
                    argmax = result[:, 0].argmax().item()
                    highest_valid = result[:, 0].max().item()
                    final_test = result[argmax, 1].item()
                    highest_eval_point = argmax + 1

                print(f'Run {run + 1:02d}:', file=f)
                print(f'Highest Valid: {highest_valid:.2f}', file=f)
                print(f'Highest Eval Point: {highest_eval_point}', file=f)
                print(f'   Final Test: {final_test:.2f}', file=f)
        else:
            result = 100 * torch.tensor(self.results)
            print("Shape of result (run is None):", result.shape)

            best_results = []
            for r in result:
                if r.numel() == 0:
                    best_results.append((float('nan'), float('nan')))
                elif r.ndim == 1:
                    valid = r.max().item()
                    test = r[r.argmax()].item()
                    best_results.append((valid, test))
                else:
                    valid = r[:, 0].max().item()
                    test = r[r[:, 0].argmax(), 1].item()
                    best_results.append((valid, test))

            best_result = torch.tensor(best_results)

            print(f'All runs:', file=f)
            r = best_result[:, 0]
            if r.numel() == 0:
                print(f'Highest Valid: N/A', file=f)
                print(f'   Final Test: N/A', file=f)
            else:
                print(f'Highest Valid: {r.mean():.2f} ± {r.std():.2f}', file=f)
                r = best_result[:, 1]
                print(f'   Final Test: {r.mean():.2f} ± {r.std():.2f}', file=f)

import time

def generate_node2vec_embeddings(graph, emd_size=128, negative_injection=False, train_neg=None, nums_workers=8):
    """
    Generate node embeddings using the ProNE algorithm.

    :param graph: NetworkX graph
    :param emd_size: Dimensionality of the embeddings
    :return: Torch tensor of node embeddings
    """

    # Convert graph to CSR matrix if necessary
    if isinstance(graph, nx.Graph):
        graph = sparse.csr_matrix(nx.adjacency_matrix(graph))




    # Start timing
    start_time = perf_counter()

    # Initialize and fit ProNE
    try:
        prone = ProNE(n_components=emd_size, step=20, mu=0.1, theta=0.7) # 不需要指定 dimensions 参数
        fit_start = perf_counter()
        embeddings = prone.fit_transform(graph)  # 通过 fit_transform 指定维度
        fit_end = perf_counter()
        print(f"ProNE fitting took: {fit_end - fit_start:.2f} seconds")
    except Exception as e:
        raise RuntimeError(f"Failed to generate embeddings using ProNE: {e}")

    # Convert embeddings to a Torch tensor
    embeddings_tensor = torch.from_numpy(embeddings).float()

    # Output total time
    total_time = perf_counter() - start_time
    print(f"Total process time: {total_time:.2f} seconds")

    return embeddings_tensor






def generate_node2vec_embeddings0(graph, emd_size=128, negative_injection=False, train_neg=None, nums_workers=8):
    '''
    Generate node embeddings using the Node2Vec algorithm.
    Only performs negative injection if there are truly negative samples specified.

    :param graph: NetworkX graph
    :param emd_size: Dimensionality of the embeddings
    :param negative_injection: Boolean to decide if negative samples should be considered
    :param train_neg: Training data for negative samples
    :return: NumPy array of node embeddings
    '''


    # Initialize Node2Vec with specified parameters
    # 初始化计时
    start = perf_counter()
    print_memory_usage("Start")
    print_io_usage("Start")



    # 初始化 Node2Vec
    init_start = perf_counter()
    node2vec = Node2Vec(graph, dimensions=emd_size, walk_length=5, num_walks=3, workers=nums_workers)
    node2vec.walks  # 确保随机游走完全完成
    init_end = perf_counter()
    print_memory_usage("After Node2Vec Initialization")
    print_io_usage("After Node2Vec Initialization")



    # Fit 模型
    fit_start = perf_counter()
    model = node2vec.fit(window=5, min_count=0, sg=1, workers=nums_workers, vector_size=emd_size, epochs=1)
    fit_end = perf_counter()
    print_memory_usage("After Node2Vec Fit")
    print_io_usage("After Node2Vec Fit")


    # 输出精确时间
    print(f"Node2Vec initialization took: {init_end - init_start:.2f} seconds")
    print(f"Model fitting took: {fit_end - fit_start:.2f} seconds")
    print(f"Total process time: {fit_end - start:.2f} seconds")


    # Generate embeddings for each node, assigning zero vector to nodes without embeddings
    embeddings = np.array([model.wv[str(i)] if str(i) in model.wv else np.zeros(emd_size) for i in range(len(graph))])

    # Calculate the mean embedding for nodes that received non-zero embeddings
    non_zero_embeddings = embeddings[np.any(embeddings != 0, axis=1)]
    if non_zero_embeddings.size > 0:
        mean_embedding = np.mean(non_zero_embeddings, axis=0)
        embeddings[~np.any(embeddings != 0, axis=1)] = mean_embedding
    else:
        raise RuntimeError("No embeddings generated. Check the input graph and parameters.")

    embeddings_tensor = torch.from_numpy(embeddings).float()
    return embeddings_tensor



def generate_node2vec_embeddings3(A, emd_size=128, negative_injection=False, train_neg=None):
    '''
    including neg injection
    '''

    if negative_injection:
        row, col = train_neg
        A = A.copy()
        A[row, col] = 1  # inject negative train
        A[col, row] = 1  # inject negative train
    nx_G = nx.from_scipy_sparse_matrix(A)
    G = node2vec.Graph(nx_G, is_directed=False, p=1, q=1)
    G.preprocess_transition_probs()
    walks = G.simulate_walks(num_walks=10, walk_length=80)
    walks = [list(map(str, walk)) for walk in walks]
    model = Word2Vec(walks, size=emd_size, window=10, min_count=0, sg=1, 
            workers=8, iter=1)
    wv = model.wv
    embeddings = np.zeros([A.shape[0], emd_size], dtype='float32')
    sum_embeddings = 0
    empty_list = []
    for i in range(A.shape[0]):
        if str(i) in wv:
            embeddings[i] = wv.word_vec(str(i))
            sum_embeddings += embeddings[i]
        else:
            empty_list.append(i)
    mean_embedding = sum_embeddings / (A.shape[0] - len(empty_list))
    embeddings[empty_list] = mean_embedding
    return embeddings




# from torch_geometric.nn import Node2Vec

def generate_node2vec_embeddings4(graph, emd_size=128, negative_injection=False, train_neg=None, nums_workers=4):
    
    """
    Generate embeddings using PyTorch-Geometric's Node2Vec implementation.
    """
    emd_size=128
    walk_length=10
    num_walks=5
    batch_size=128
    workers = nums_workers
    context_size=10

    from torch_geometric.nn import Node2Vec
    from torch_geometric.utils import from_networkx
    import torch
    import networkx as nx


    """
    High-performance Node2Vec using PyTorch-Geometric.
    """
    # Convert NetworkX graph to PyTorch-Geometric format
    data = from_networkx(graph)

    # Initialize Node2Vec
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = Node2Vec(
        edge_index=data.edge_index,
        embedding_dim=emd_size,
        walk_length=walk_length,
        context_size=context_size,
        walks_per_node=num_walks,
        num_negative_samples=1,
        sparse=True  # Use sparse gradients for efficiency
    ).to(device)

    # Optimizer
    loader = model.loader(batch_size=128, shuffle=True, num_workers=4)
    optimizer = torch.optim.SparseAdam(model.parameters(), lr=0.01)

    # Training loop
    model.train()
    for epoch in range(5):  # Train for 5 epochs
        total_loss = 0
        for pos_rw, neg_rw in loader:
            optimizer.zero_grad()
            loss = model.loss(pos_rw.to(device), neg_rw.to(device))
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        print(f"Epoch {epoch + 1}, Loss: {total_loss:.4f}")

    # Generate embeddings
    embeddings = model.embedding.weight.data.cpu()
    return embeddings




def convert_to_networkx(data):
    # Convert the PyTorch Geometric data object to a networkx graph
    # Assuming the data object doesn't have directed edges
    G = to_networkx(data)
    G = G.to_undirected()
    return G




from torch_geometric.data import Batch

def safe_collate(batch):
    valid_data = []
    for data in batch:
        # 检查数据是否符合要求
        if data.x is not None and data.x.ndim == 2 and data.edge_index is not None and data.edge_index.ndim == 2 and data.edge_index.shape[0] == 2:
            valid_data.append(data)
        else:
            print(f"Skipping invalid Data object: x={None if data.x is None else data.x.shape}, edge_index={None if data.edge_index is None else data.edge_index.shape}")
    # 返回有效的数据批次
    return Batch.from_data_list(valid_data)



# class GraphDataset(IterableDataset):
#     def __init__(self, dataset):
#         super().__init__()
#         self.dataset = dataset

#     def __iter__(self):
#         for data in self.dataset:
#             yield data

# def custom_collate_fn(batch):
#     # 我们使用 PyTorch Geometric 的 Batch 来处理图数据的合并
#     batch = Batch.from_data_list(batch)
#     if batch.edge_index.max().item() >= batch.num_nodes:
#         print(f"Warning: max node index {batch.edge_index.max().item()} exceeds number of nodes {batch.num_nodes}")
#     return batch



# class CustomDataLoader(DataLoader):
#     def __init__(self, dataset, batch_size=1, shuffle=False, sampler=None, batch_sampler=None,
#                  num_workers=0, collate_fn=None, pin_memory=False, drop_last=False,
#                  timeout=0, worker_init_fn=None, multiprocessing_context=None, generator=None,
#                  *, prefetch_factor=None, persistent_workers=False, pin_memory_device=""):
#         # 使用自定义的 collate_fn，如果没有提供，则使用默认的
#         if collate_fn is None:
#             collate_fn = self.custom_collate_fn
#         super().__init__(
#             dataset, batch_size=batch_size, shuffle=shuffle, sampler=sampler, batch_sampler=batch_sampler,
#             num_workers=num_workers, collate_fn=collate_fn, pin_memory=pin_memory, drop_last=drop_last,
#             timeout=timeout, worker_init_fn=worker_init_fn, multiprocessing_context=multiprocessing_context,
#             generator=generator, prefetch_factor=prefetch_factor, persistent_workers=persistent_workers,
#             pin_memory_device=pin_memory_device
#         )
        
#     def custom_collate_fn(batch):
#         # 这里是处理批次的逻辑，确保没有增加节点ID的逻辑
#         return torch_geometric.data.Batch.from_data_list(batch)
    





class CustomDataLoader2:
    def __init__(self, dataset, batch_size, shuffle=True):
        self.dataset = dataset
        self.batch_size = batch_size
        self.shuffle = shuffle

    def __iter__(self):
        # 如果启用了打乱，打乱数据集顺序
        if self.shuffle:
            indices = torch.randperm(len(self.dataset))
        else:
            indices = torch.arange(len(self.dataset))

        # 创建批次
        for i in range(0, len(indices), self.batch_size):
            batch_indices = indices[i:i+self.batch_size]
            batch_data = [self.dataset[j] for j in batch_indices]
            edge_index_batch = torch.cat([data.edge_index for data in batch_data], dim=1)
            x_batch = torch.cat([data.x for data in batch_data], dim=0)


            # 确保 node_id 也被适当地偏移和合并
            if hasattr(batch_data[0], 'node_id'):  # 检查数据中是否存在 node_id
                node_id_offset = 0
                node_ids = []
                for data in batch_data:
                    node_ids.append(data.node_id + node_id_offset)
                    node_id_offset += data.x.size(0)
                node_id_batch = torch.cat(node_ids)

                # 添加打印来检查每个批次中节点 ID 的情况
                print(f"Batch {i//self.batch_size}: Max node ID = {node_id_batch.max().item()}")

            # 组装并返回一个 Data 对象，包含 node_id
            yield Data(x=x_batch, edge_index=edge_index_batch, node_id=node_id_batch)


            # # 在这里添加打印以检查每个批次的数据
            # max_node_id = edge_index_batch.max().item()
            # print(f"Batch {i//self.batch_size}: Max node ID = {max_node_id}")

            # # 检查是否有超出预期的 node ID
            # if max_node_id >= 4000:  # 假设你的节点嵌入向量大小为 4000
            #     print(f"Error: Max node ID {max_node_id} in batch exceeds embedding size.")
            #     print(f"Edge indices: {edge_index_batch}")

            # 组装并返回一个 Data 对象
            # yield Data(x=x_batch, edge_index=edge_index_batch)



def split_pred_edges(pred_edge_index, train_ratio=0.8, valid_ratio=0.1, test_ratio=0.1, seed=42):
    """
    Splits pred_edge_index into train, validation, and test sets.
    
    Args:
    - pred_edge_index (torch.Tensor): shape [2, num_edges], containing predicted edges.
    - train_ratio (float): Fraction of edges for training.
    - valid_ratio (float): Fraction of edges for validation.
    - test_ratio (float): Fraction of edges for testing.

    Returns:
    - dict: Splits of predicted edges.
    """
    assert train_ratio + valid_ratio + test_ratio == 1.0, "train/valid/test ratios must sum to 1.0"

    num_edges = pred_edge_index.size(1)
    num_nodes = torch.max(pred_edge_index) + 1  # 假设 ID 是从 0 开始的连续整数



    # 按比例拆分
    num_train_edges = int(num_edges * train_ratio)
    num_valid_edges = int(num_edges * valid_ratio)
    num_test_edges = num_edges - num_train_edges - num_valid_edges

    train_edges = pred_edge_index[:, :num_train_edges]
    valid_edges = pred_edge_index[:, num_train_edges:num_train_edges + num_valid_edges]
    test_edges = pred_edge_index[:, num_train_edges + num_valid_edges:]

    # **所有数据集都包含相同的节点**
    all_nodes = torch.arange(num_nodes)

    return {
        'train': {'edge': train_edges, 'nodes': all_nodes},
        'valid': {'edge': valid_edges, 'nodes': all_nodes},
        'test': {'edge': test_edges, 'nodes': all_nodes},
        'all': {'edge': pred_edge_index, 'nodes': all_nodes},  # 完整预测集
    }



    def __len__(self):
        return (len(self.dataset) + self.batch_size - 1) // self.batch_size