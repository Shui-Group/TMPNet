# Copyright (c) Facebook, Inc. and its affiliates.
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

import math
import numpy as np
import torch
from torch.nn import (ModuleList, Linear, Conv1d, MaxPool1d, Embedding, ReLU, 
                      Sequential, BatchNorm1d as BN)
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import (GCNConv, SAGEConv, GINConv, 
                                global_sort_pool, global_add_pool, global_mean_pool)


class GCN(torch.nn.Module):
    def __init__(self, hidden_channels, num_layers, max_z, train_dataset, 
                 use_feature=False, node_embedding=None, dropout=0.5):
        super(GCN, self).__init__()
        self.use_feature = use_feature
        self.node_embedding = node_embedding
        self.max_z = max_z
        self.z_embedding = Embedding(self.max_z, hidden_channels)

        self.convs = ModuleList()
        initial_channels = hidden_channels
        if self.use_feature:
            initial_channels += train_dataset.num_features
        if self.node_embedding is not None:
            initial_channels += node_embedding.embedding_dim
        self.convs.append(GCNConv(initial_channels, hidden_channels))
        for _ in range(num_layers - 1):
            self.convs.append(GCNConv(hidden_channels, hidden_channels))

        self.dropout = dropout
        self.lin1 = Linear(hidden_channels, hidden_channels)
        self.lin2 = Linear(hidden_channels, 1)

    def reset_parameters(self):
        for conv in self.convs:
            conv.reset_parameters()

    def forward(self, z, edge_index, batch, x=None, edge_weight=None, node_id=None):
        z_emb = self.z_embedding(z)
        if z_emb.ndim == 3:  # in case z has multiple integer labels
            z_emb = z_emb.sum(dim=1)
        if self.use_feature and x is not None:
            x = torch.cat([z_emb, x.to(torch.float)], 1)
        else:
            x = z_emb
        if self.node_embedding is not None and node_id is not None:
            n_emb = self.node_embedding(node_id)
            x = torch.cat([x, n_emb], 1)
        for conv in self.convs[:-1]:
            x = conv(x, edge_index, edge_weight)
            x = F.relu(x)
            x = F.dropout(x, p=self.dropout, training=self.training)
        x = self.convs[-1](x, edge_index, edge_weight)
        if True:  # center pooling
            _, center_indices = np.unique(batch.cpu().numpy(), return_index=True)
            x_src = x[center_indices]
            x_dst = x[center_indices + 1]
            x = (x_src * x_dst)
            x = F.relu(self.lin1(x))
            x = F.dropout(x, p=self.dropout, training=self.training)
            x = self.lin2(x)
        else:  # sum pooling
            x = global_add_pool(x, batch)
            x = F.relu(self.lin1(x))
            x = F.dropout(x, p=self.dropout, training=self.training)
            x = self.lin2(x)

        return x


class SAGE(torch.nn.Module):
    def __init__(self, hidden_channels, num_layers, max_z, train_dataset=None, 
                 use_feature=False, node_embedding=None, dropout=0.5):
        super(SAGE, self).__init__()
        self.use_feature = use_feature
        self.node_embedding = node_embedding
        self.max_z = max_z
        self.z_embedding = Embedding(self.max_z, hidden_channels)

        self.convs = ModuleList()
        initial_channels = hidden_channels
        if self.use_feature:
            initial_channels += train_dataset.num_features
        if self.node_embedding is not None:
            initial_channels += node_embedding.embedding_dim
        self.convs.append(SAGEConv(initial_channels, hidden_channels))
        for _ in range(num_layers - 1):
            self.convs.append(SAGEConv(hidden_channels, hidden_channels))

        self.dropout = dropout
        self.lin1 = Linear(hidden_channels, hidden_channels)
        self.lin2 = Linear(hidden_channels, 1)

    def reset_parameters(self):
        for conv in self.convs:
            conv.reset_parameters()

    def forward(self, z, edge_index, batch, x=None, edge_weight=None, node_id=None):
        z_emb = self.z_embedding(z)
        if z_emb.ndim == 3:  # in case z has multiple integer labels
            z_emb = z_emb.sum(dim=1)
        if self.use_feature and x is not None:
            x = torch.cat([z_emb, x.to(torch.float)], 1)
        else:
            x = z_emb
        if self.node_embedding is not None and node_id is not None:
            n_emb = self.node_embedding(node_id)
            x = torch.cat([x, n_emb], 1)
        for conv in self.convs[:-1]:
            x = conv(x, edge_index)
            x = F.relu(x)
            x = F.dropout(x, p=self.dropout, training=self.training)
        x = self.convs[-1](x, edge_index)
        if True:  # center pooling
            _, center_indices = np.unique(batch.cpu().numpy(), return_index=True)
            x_src = x[center_indices]
            x_dst = x[center_indices + 1]
            x = (x_src * x_dst)
            x = F.relu(self.lin1(x))
            x = F.dropout(x, p=self.dropout, training=self.training)
            x = self.lin2(x)
        else:  # sum pooling
            x = global_add_pool(x, batch)
            x = F.relu(self.lin1(x))
            x = F.dropout(x, p=self.dropout, training=self.training)
            x = self.lin2(x)

        return x


# An end-to-end deep learning architecture for graph classification, AAAI-18.
class DGCNN(torch.nn.Module):
    def __init__(self, hidden_channels, num_layers, max_z, k=0.6, train_dataset=None, 
                 dynamic_train=False, GNN=GCNConv, use_feature=False, 
                 node_embedding=None):
        super(DGCNN, self).__init__()

        self.use_feature = use_feature
        self.node_embedding = node_embedding

        if k <= 1:  # Transform percentile to number.
            if train_dataset is None:
                k = 30
            else:
                if dynamic_train:
                    sampled_train = train_dataset[:1000]
                else:
                    sampled_train = train_dataset
                num_nodes = sorted([g.num_nodes for g in sampled_train])
                k = num_nodes[int(math.ceil(k * len(num_nodes))) - 1]
                k = max(10, k)
        self.k = 285 #int(k)

        self.max_z = max_z
        self.z_embedding = Embedding(self.max_z, hidden_channels)

        self.convs = ModuleList()
        initial_channels = hidden_channels
        if self.use_feature:
            initial_channels += train_dataset.num_features
        if self.node_embedding is not None:
            initial_channels += node_embedding.embedding_dim

        self.convs.append(GNN(initial_channels, hidden_channels))
        for i in range(0, num_layers-1):
            self.convs.append(GNN(hidden_channels, hidden_channels))
        self.convs.append(GNN(hidden_channels, 1))

        conv1d_channels = [16, 32]
        total_latent_dim = hidden_channels * num_layers + 1
        conv1d_kws = [total_latent_dim, 5]
        self.conv1 = Conv1d(1, conv1d_channels[0], conv1d_kws[0],
                            conv1d_kws[0])
        self.maxpool1d = MaxPool1d(2, 2)
        self.conv2 = Conv1d(conv1d_channels[0], conv1d_channels[1],
                            conv1d_kws[1], 1)
        dense_dim = int((self.k - 2) / 2 + 1)
        dense_dim = (dense_dim - conv1d_kws[1] + 1) * conv1d_channels[1]
        self.lin1 = Linear(dense_dim, 128)
        self.lin2 = Linear(128, 1)



    def forward(self, z, edge_index, batch, x=None, edge_weight=None, node_id=None):

        # 在查找嵌入之前添加检查
        max_node_id = node_id.max().item()
        num_embeddings = self.node_embedding.weight.size(0)
        if max_node_id >= num_embeddings:
            raise ValueError(f"Node ID out of bounds: {max_node_id} >= {num_embeddings}")
        if (node_id < 0).any():
            raise ValueError("Negative node_id detected")    


        z_emb = self.z_embedding(z)
        if z_emb.ndim == 3:  # in case z has multiple integer labels
            z_emb = z_emb.sum(dim=1)
        if self.use_feature and x is not None:
            x = torch.cat([z_emb, x.to(torch.float)], 1)
        else:
            x = z_emb
        if self.node_embedding is not None and node_id is not None:
            n_emb = self.node_embedding(node_id)
            x = torch.cat([x, n_emb], 1)
        xs = [x]

        for conv in self.convs:
            xs += [torch.tanh(conv(xs[-1], edge_index, edge_weight))]
        x = torch.cat(xs[1:], dim=-1)

        # Global pooling.
        x = global_sort_pool(x, batch, self.k)
        x = x.unsqueeze(1)  # [num_graphs, 1, k * hidden]
        x = F.relu(self.conv1(x))
        x = self.maxpool1d(x)
        x = F.relu(self.conv2(x))
        x = x.view(x.size(0), -1)  # [num_graphs, dense_dim]

        # MLP.
        x = F.relu(self.lin1(x))
        x = F.dropout(x, p=0.5, training=self.training)
        x = self.lin2(x)
        return x
'''

import math
import torch
import torch.nn.functional as F
from torch.nn import Linear, Embedding, ModuleList, Conv1d, MaxPool1d, ReLU, Dropout, Sequential
from torch_geometric.nn import global_sort_pool, GCNConv

class DGCNN(torch.nn.Module):
    def __init__(self, hidden_channels, num_layers, max_z, k=0.6, train_dataset=None,
                 dynamic_train=False, GNN=GCNConv, use_feature=False, node_embedding=None):
        super(DGCNN, self).__init__()

        self.use_feature = use_feature
        self.node_embedding = node_embedding

        # ---------- 排序池化 k ----------
        if k <= 1:
            if train_dataset is None:
                k = 30
            else:
                sampled_train = train_dataset[:1000] if dynamic_train else train_dataset
                num_nodes = sorted([g.num_nodes for g in sampled_train])
                k = num_nodes[int(math.ceil(k * len(num_nodes))) - 1]
                k = max(10, k)
        self.k = 285  # 固定排序池化长度

        # ---------- 嵌入 ----------
        self.max_z = max_z
        self.z_embedding = Embedding(self.max_z, hidden_channels)

        # ---------- 两层 MLP 降维：2560 → 1024 → 512 ----------
        self.input_project = Sequential(
            Linear(2560, 1024),
            ReLU(),
            Linear(1024, 512)
        )

        # ---------- GNN 结构 ----------
        self.convs = ModuleList()
        initial_channels = hidden_channels

        if self.use_feature:
            initial_channels += 512  # 降维后的维度
        if self.node_embedding is not None:
            initial_channels += node_embedding.embedding_dim

        self.convs.append(GNN(initial_channels, hidden_channels))
        for _ in range(num_layers - 1):
            self.convs.append(GNN(hidden_channels, hidden_channels))
        self.convs.append(GNN(hidden_channels, 1))  # 排序池化用

        # ---------- 1D 卷积 + MLP ----------
        conv1d_channels = [16, 32]
        total_latent_dim = hidden_channels * num_layers + 1
        conv1d_kws = [total_latent_dim, 5]

        self.conv1 = Conv1d(1, conv1d_channels[0], conv1d_kws[0], conv1d_kws[0])
        self.maxpool1d = MaxPool1d(2, 2)
        self.conv2 = Conv1d(conv1d_channels[0], conv1d_channels[1], conv1d_kws[1], 1)

        dense_dim = int((self.k - 2) / 2 + 1)
        dense_dim = (dense_dim - conv1d_kws[1] + 1) * conv1d_channels[1]

        self.lin1 = Linear(dense_dim, 128)
        self.lin2 = Linear(128, 1)

    def forward(self, z, edge_index, batch, x=None, edge_weight=None, node_id=None):
        if self.node_embedding is not None and node_id is not None:
            if node_id.max().item() >= self.node_embedding.weight.size(0):
                raise ValueError("Node ID out of bounds")
            if (node_id < 0).any():
                raise ValueError("Negative node_id detected")

        z_emb = self.z_embedding(z)
        if z_emb.ndim == 3:
            z_emb = z_emb.sum(dim=1)

        if self.use_feature and x is not None:
            x = self.input_project(x.to(torch.float))  # MLP降维：2560→1024→512
            x = torch.cat([z_emb, x], dim=1)
        else:
            x = z_emb

        if self.node_embedding is not None and node_id is not None:
            n_emb = self.node_embedding(node_id)
            x = torch.cat([x, n_emb], dim=1)

        xs = [x]
        for conv in self.convs:
            xs.append(torch.tanh(conv(xs[-1], edge_index, edge_weight)))
        x = torch.cat(xs[1:], dim=-1)

        x = global_sort_pool(x, batch, self.k)
        x = x.unsqueeze(1)  # [batch_size, 1, k * feature_dim]

        x = F.relu(self.conv1(x))
        x = self.maxpool1d(x)
        x = F.relu(self.conv2(x))
        x = x.view(x.size(0), -1)  # Flatten

        x = F.relu(self.lin1(x))
        x = F.dropout(x, p=0.5, training=self.training)
        x = self.lin2(x)
        return x

'''


class DGCNN_finetune(torch.nn.Module):
    def __init__(self, hidden_channels, num_layers, max_z, k=0.6, train_dataset=None, 
                 dynamic_train=False, GNN=GCNConv, use_feature=False, 
                 node_embedding=None):
        super(DGCNN_finetune, self).__init__()

        self.use_feature = use_feature
        self.node_embedding = node_embedding
        
        if k <= 1:  # Transform percentile to number.
            if train_dataset is None:
                k = 30
            else:
                if dynamic_train:
                    sampled_train = train_dataset[:1000]
                else:
                    sampled_train = train_dataset
                num_nodes = sorted([g.num_nodes for g in sampled_train])
                k = num_nodes[int(math.ceil(k * len(num_nodes))) - 1]
                k = max(10, k)
        self.k = int(k)
        
        # 使用预训练的 k 值
        self.k = 285  #264 将此值设置为预训练模型的实际 k 值

        self.max_z = max_z
        self.z_embedding = Embedding(self.max_z, hidden_channels)


        self.convs = ModuleList()
        initial_channels = hidden_channels
        if self.use_feature:
            initial_channels += train_dataset.num_features
        if self.node_embedding is not None:
            initial_channels += node_embedding.embedding_dim

        self.convs.append(GNN(initial_channels, hidden_channels))
        for i in range(0, num_layers-1):
            self.convs.append(GNN(hidden_channels, hidden_channels))
        self.convs.append(GNN(hidden_channels, 1))

        conv1d_channels = [16, 32]
        total_latent_dim = hidden_channels * num_layers + 1
        conv1d_kws = [total_latent_dim, 5]
        self.conv1 = Conv1d(1, conv1d_channels[0], conv1d_kws[0],
                            conv1d_kws[0])
        self.maxpool1d = MaxPool1d(2, 2)
        self.conv2 = Conv1d(conv1d_channels[0], conv1d_channels[1],
                            conv1d_kws[1], 1)
        dense_dim = int((self.k - 2) / 2 + 1)
        dense_dim = (dense_dim - conv1d_kws[1] + 1) * conv1d_channels[1]
        self.lin1 = Linear(dense_dim, 128)
        self.lin2 = Linear(128, 1)

    def forward(self, z, edge_index, batch, x=None, edge_weight=None, node_id=None):


        z_emb = self.z_embedding(z)
        if z_emb.ndim == 3:  # in case z has multiple integer labels
            z_emb = z_emb.sum(dim=1)
        if self.use_feature and x is not None:
            x = torch.cat([z_emb, x.to(torch.float)], 1)
        else:
            x = z_emb
        if self.node_embedding is not None and node_id is not None:
            n_emb = self.node_embedding(node_id)
            x = torch.cat([x, n_emb], 1)
        xs = [x]
        
        for conv in self.convs:
            xs += [torch.tanh(conv(xs[-1], edge_index, edge_weight))]
        x = torch.cat(xs[1:], dim=-1)
        
        # Global pooling.
        x = global_sort_pool(x, batch, self.k)
        x = x.unsqueeze(1)  # [num_graphs, 1, k * hidden]
        x = F.relu(self.conv1(x))
        x = self.maxpool1d(x)
        x = F.relu(self.conv2(x))
        x = x.view(x.size(0), -1)  # [num_graphs, dense_dim]

        # MLP.
        x = F.relu(self.lin1(x))
        x = F.dropout(x, p=0.5, training=self.training)
        x = self.lin2(x)
        return x
'''

class DGCNN_finetune(nn.Module):
    def __init__(self, hidden_channels, num_layers, max_z, k=0.6, train_dataset=None, 
                 dynamic_train=False, GNN=GCNConv, use_feature=False, 
                 node_embedding=None):
        super(DGCNN_finetune, self).__init__()

        self.use_feature = use_feature
        self.node_embedding = node_embedding

        if k <= 1:
            if train_dataset is None:
                k = 30
            else:
                sampled_train = train_dataset[:1000] if dynamic_train else train_dataset
                num_nodes = sorted([g.num_nodes for g in sampled_train])
                k = num_nodes[int(torch.ceil(torch.tensor(k * len(num_nodes))).item()) - 1]
                k = max(10, k)
        self.k = 285

        self.max_z = max_z
        self.z_embedding = Embedding(self.max_z, hidden_channels)

        # ✅ 修改为两层 MLP：2560 → 1024 → 512
        self.input_project = nn.Sequential(
            nn.Linear(2560, 1024),
            nn.ReLU(),
            nn.Linear(1024, 512)
        )

        self.convs = ModuleList()
        initial_channels = hidden_channels
        if self.use_feature:
            initial_channels += 512
        if self.node_embedding is not None:
            initial_channels += node_embedding.embedding_dim

        self.convs.append(GNN(initial_channels, hidden_channels))
        for _ in range(num_layers - 1):
            self.convs.append(GNN(hidden_channels, hidden_channels))
        self.convs.append(GNN(hidden_channels, 1))

        conv1d_channels = [16, 32]
        total_latent_dim = hidden_channels * num_layers + 1
        conv1d_kws = [total_latent_dim, 5]
        self.conv1 = Conv1d(1, conv1d_channels[0], conv1d_kws[0], conv1d_kws[0])
        self.maxpool1d = MaxPool1d(2, 2)
        self.conv2 = Conv1d(conv1d_channels[0], conv1d_channels[1], conv1d_kws[1], 1)

        dense_dim = int((self.k - 2) / 2 + 1)
        dense_dim = (dense_dim - conv1d_kws[1] + 1) * conv1d_channels[1]
        self.lin1 = Linear(dense_dim, 128)
        self.lin2 = Linear(128, 1)

    def forward(self, z, edge_index, batch, x=None, edge_weight=None, node_id=None):
        z_emb = self.z_embedding(z)
        if z_emb.ndim == 3:
            z_emb = z_emb.sum(dim=1)

        if self.use_feature and x is not None:
            x = self.input_project(x.to(torch.float))  # 2560 → 1024 → 512
            x = torch.cat([z_emb, x], 1)
        else:
            x = z_emb

        if self.node_embedding is not None and node_id is not None:
            n_emb = self.node_embedding(node_id)
            x = torch.cat([x, n_emb], 1)

        xs = [x]
        for conv in self.convs:
            xs.append(torch.tanh(conv(xs[-1], edge_index, edge_weight)))
        x = torch.cat(xs[1:], dim=-1)

        x = global_sort_pool(x, batch, self.k)
        x = x.unsqueeze(1)
        x = F.relu(self.conv1(x))
        x = self.maxpool1d(x)
        x = F.relu(self.conv2(x))
        x = x.view(x.size(0), -1)

        x = F.relu(self.lin1(x))
        x = F.dropout(x, p=0.5, training=self.training)
        x = self.lin2(x)
        return x



    # def forward(self, z, edge_index, batch, x=None, edge_weight=None, node_id=None):
    #         print(f"Input z shape: {z.shape}")
    #         print(f"Input edge_index shape: {edge_index.shape}")
    #         if x is not None:
    #             print(f"Input x shape: {x.shape}")
    #         if node_id is not None:
    #             print(f"Input node_id shape: {node_id.shape}")

    #         z_emb = self.z_embedding(z)
    #         print(f"z_emb shape after embedding: {z_emb.shape}")
    #         if self.use_feature and x is not None:
    #             x = torch.cat([z_emb, x.to(torch.float)], 1)
    #         else:
    #             x = z_emb
    #         print(f"x shape after concatenation: {x.shape}")
    #         # if self.node_embedding is not None and node_id is not None:
    #         #      x = self.node_embedding(node_id)
    #         if self.node_embedding is not None and node_id is not None:
    #             n_emb = self.node_embedding(node_id)
    #             x = torch.cat([x, n_emb], 1)
    #             x = x[:, :538]

    #         print(f"x shape after adding node_embedding: {x.shape}")

    #         xs = [x]
    #         for i, conv in enumerate(self.convs):
    #             xs.append(torch.tanh(conv(xs[-1], edge_index, edge_weight)))
    #             print(f"x shape after conv {i}: {xs[-1].shape}")

    #         x = torch.cat(xs[1:], dim=-1)
    #         print(f"x shape after concatenation of all layers: {x.shape}")

    #         x = global_sort_pool(x, batch, self.k)
    #         print(f"x shape after global_sort_pool: {x.shape}")

    #         x = x.unsqueeze(1)  # [num_graphs, 1, k * hidden]
    #         x = F.relu(self.conv1(x))
    #         print(f"x shape after conv1: {x.shape}")

    #         x = self.maxpool1d(x)
    #         print(f"x shape after maxpool1d: {x.shape}")

    #         x = F.relu(self.conv2(x))
    #         print(f"x shape after conv2: {x.shape}")

    #         x = x.view(x.size(0), -1)  # Flatten
    #         print(f"x shape after flattening: {x.shape}")

    #         x = F.relu(self.lin1(x))
    #         print(f"x shape after lin1: {x.shape}")

    #         x = F.dropout(x, p=0.5, training=self.training)
    #         x = self.lin2(x)
    #         print(f"x shape after lin2 (output): {x.shape}")

    #         return x

    # def forward(self, z, edge_index, batch, x=None, edge_weight=None, node_id=None):

    #     # 在查找嵌入之前添加检查
    #     max_node_id = node_id.max().item()
    #     num_embeddings = self.node_embedding.weight.size(0)
    #     if max_node_id >= num_embeddings:
    #         raise ValueError(f"Node ID out of bounds: {max_node_id} >= {num_embeddings}")
    #     if (node_id < 0).any():
    #         raise ValueError("Negative node_id detected")    


    #     z_emb = self.z_embedding(z)
    #     if z_emb.ndim == 3:  # in case z has multiple integer labels
    #         z_emb = z_emb.sum(dim=1)
    #     if self.use_feature and x is not None:
    #         x = torch.cat([z_emb, x.to(torch.float)], 1)
    #     else:
    #         x = z_emb
    #     if self.node_embedding is not None and node_id is not None:
    #         n_emb = self.node_embedding(node_id)
    #         x = torch.cat([x, n_emb], 1)
    #     xs = [x]

    #     for conv in self.convs:
    #         xs += [torch.tanh(conv(xs[-1], edge_index, edge_weight))]
    #     x = torch.cat(xs[1:], dim=-1)

    #     # Global pooling.
    #     x = global_sort_pool(x, batch, self.k)
    #     x = x.unsqueeze(1)  # [num_graphs, 1, k * hidden]
    #     x = F.relu(self.conv1(x))
    #     x = self.maxpool1d(x)
    #     x = F.relu(self.conv2(x))
    #     x = x.view(x.size(0), -1)  # [num_graphs, dense_dim]

    #     # MLP.
    #     x = F.relu(self.lin1(x))
    #     x = F.dropout(x, p=0.5, training=self.training)
    #     x = self.lin2(x)
    #     return x

'''

class GIN(torch.nn.Module):
    def __init__(self, hidden_channels, num_layers, max_z, train_dataset,
                 use_feature=False, node_embedding=None, dropout=0.5, 
                 jk=True, train_eps=False):
        super(GIN, self).__init__()
        self.use_feature = use_feature
        self.node_embedding = node_embedding
        self.max_z = max_z
        self.z_embedding = Embedding(self.max_z, hidden_channels)
        self.jk = jk

        initial_channels = hidden_channels
        if self.use_feature:
            initial_channels += train_dataset.num_features
        if self.node_embedding is not None:
            initial_channels += node_embedding.embedding_dim
        self.conv1 = GINConv(
            Sequential(
                Linear(initial_channels, hidden_channels),
                ReLU(),
                Linear(hidden_channels, hidden_channels),
                ReLU(),
                BN(hidden_channels),
            ),
            train_eps=train_eps)
        self.convs = torch.nn.ModuleList()
        for i in range(num_layers - 1):
            self.convs.append(
                GINConv(
                    Sequential(
                        Linear(hidden_channels, hidden_channels),
                        ReLU(),
                        Linear(hidden_channels, hidden_channels),
                        ReLU(),
                        BN(hidden_channels),
                    ),
                    train_eps=train_eps))

        self.dropout = dropout
        if self.jk:
            self.lin1 = Linear(num_layers * hidden_channels, hidden_channels)
        else:
            self.lin1 = Linear(hidden_channels, hidden_channels)
        self.lin2 = Linear(hidden_channels, 1)

    def forward(self, z, edge_index, batch, x=None, edge_weight=None, node_id=None):
        z_emb = self.z_embedding(z)
        if z_emb.ndim == 3:  # in case z has multiple integer labels
            z_emb = z_emb.sum(dim=1)
        if self.use_feature and x is not None:
            x = torch.cat([z_emb, x.to(torch.float)], 1)
        else:
            x = z_emb
        if self.node_embedding is not None and node_id is not None:
            n_emb = self.node_embedding(node_id)
            x = torch.cat([x, n_emb], 1)
        x = self.conv1(x, edge_index)
        xs = [x]
        for conv in self.convs:
            x = conv(x, edge_index)
            xs += [x]
        if self.jk:
            x = global_mean_pool(torch.cat(xs, dim=1), batch)
        else:
            x = global_mean_pool(xs[-1], batch)
        x = F.relu(self.lin1(x))
        x = F.dropout(x, p=self.dropout, training=self.training)
        x = self.lin2(x)

        return x


