#%%

from torch_geometric.data import Dataset, Data
from torch.utils.data import random_split
from torch.cuda.amp import autocast
from sklearn.preprocessing import MinMaxScaler
import pandas as pd
import torch
import os
import numpy as np
import esm
import h5py
from tqdm import tqdm
import time
import json


class CustomDataset(Dataset):
    def __init__(self, roots, file_names_list,neg_files_list=None, transform=None, pre_transform=None):
        self.roots = roots
        self.file_names_list = file_names_list
        self.transform = transform
        self.pre_transform = pre_transform
        self.max_length = None
        super(CustomDataset, self).__init__(None, transform, pre_transform)
        self.data = None  # Initialize data as None to indicate that it has not been processed yet
        self.split_edge = None  # Initialize split_edge as None
        self.id_to_protein = {}
        self.model, self.alphabet = esm.pretrained.esm2_t36_3B_UR50D()
        print(f"Loaded ESM model with embedding_dim = {self.model.embed_dim}")

        #self.model, self.alphabet = esm.pretrained.load_model_and_alphabet_local("/data02/luoht/seal_ppi/TEMP/esm_model/esm2_t36_3B_UR50D.pt")
        #print(f"Loaded ESM model with embedding_dim = {model.embed_dim}")

        # self.model, self.alphabet = esm.pretrained.esm2_t6_8M_UR50D()       # esm1_t6_43M_UR50S()    # esm2_t6_8M_UR50D()  # You can choose a different version if needed
        self.batch_converter = self.alphabet.get_batch_converter()
        self.model.eval()  # Set the model to evaluation mode
        self.neg_files = neg_files_list
        self.renamed_columns = {
            "Eye": ['Eye', 'Eyes',],  
            'Kidney': ['Kidney', 'Kidneys',],  
        }

        self.final_column = ['Adrenal', 'Adrenal.Gland', 'Artery...Aorta', 'Artery...Coronary', 'Artery...Tibial', 
            'BAT', 'Brain', 'Brain...Cerebellum', 'Brain...Cortex', 'Breast...Mammary.Tissue', 'Brown', 
            'Cerebellum', 'Cervical', 'Colon...Sigmoid', 'Colon...Transverse', 'Duodenum', 'Epididymis',
            'Esophagus', 'Esophagus...Gastroesophageal.Junction', 'Esophagus...Mucosa', 
            'Esophagus...Muscularis', 'Eye', 'Femur', 'Frontal', 'GAT', 
            'Heart', 'Heart...Atrial.Appendage', 'Heart...Left.Ventricle', 'Hindbrain', 
            'Hippocampus', 'Kidney', 'Large', 'Liver', 'Lung', 'MAT', 'Mamma', 
            'Minor.Salivary.Gland', 'Muscle', 'Muscle...Skeletal', 'Nerve...Tibial', 'Occipital',
                'Olfactory', 'Ovaries', 'Ovary', 'Pancreas', 'Pituitary', 'Prostate', 'SCAT', 
                'Salivary', 'Skeletal', 'Skin', 'Skin...Not.Sun.Exposed..Suprapubic.', 
                'Skin...Sun.Exposed..Lower.leg.', 'Small', 'Small.Intestine...Terminal.Ileum', 
                'Spinal', 'Spleen', 'Stomach', 'Temporal', 'TestesAccessory', 'Testis', 'Thymus',
                'Thyroid', 'Tongue', 'Trachea', 'Urinary', 'Uterus', 'Vagina', 'White', 
                'region1', 'region10', 'region2', 'region3', 'region4', 'region5', 'region6', 'region7', 'region8', 'region9'
                ]
    '''
    def _get_common_root(self, roots):
        # 假设所有路径都以相同的根目录开始并使用 "/" 分隔
        split_paths = [root.split('/') for root in roots]
        common_root = []
        for parts in zip(*split_paths):
            if all(part == parts[0] for part in parts):
                common_root.append(parts[0])
            else:
                break
        return '/'.join(common_root)
    '''
    def determine_max_length(self):
        # Find the maximum sequence length across all datasets
        max_length = 0
        all_lengths = []
        for root, file_names in zip(self.roots, self.file_names_list):
            features_df = pd.read_csv(os.path.join(root, file_names[1]))
            sequence_lengths = features_df['sequence'].str.len()
            all_lengths.extend(sequence_lengths)

        lengths_array = np.array(all_lengths)
        self.max_length = int(np.percentile(lengths_array, 99))  # Use the 99th percentile length as the max
      
    def process_all(self):
        self.determine_max_length()
        combined_data = None

        if len(self.roots) == 1:
            print("Only one dataset found, processing without merge.")
            root, file_names = self.roots[0], self.file_names_list[0]
            data, id_to_protein_single = self.process_single(root, file_names)
            combined_data = self.process_single_data(data)
            self.id_to_protein = id_to_protein_single

        else:
            for idx, (root, file_names) in enumerate(zip(self.roots, self.file_names_list)):
                data, id_to_protein_single = self.process_single(root, file_names)
                if idx == 0:
                    combined_data = data
                    combined_id_to_protein = id_to_protein_single
                else:
                    offset = combined_data.x.size(0)
                    print(f"Merging datasets with offset {offset}")
                    combined_data = self.merge_data(combined_data, data)
                    for key, value in id_to_protein_single.items():
                        combined_id_to_protein[key + offset] = value

            self.id_to_protein = combined_id_to_protein

            # Save id_to_protein
            os.makedirs("./TEMP/id_to_protein_cache", exist_ok=True)
            with open("./TEMP/id_to_protein_cache/id_to_protein.json", "w") as f:
                json.dump(self.id_to_protein, f)
            print("id_to_protein mapping saved.")

        # ✅ 统一后处理：划分边、构造训练图
        self.split_edge = self._split_edges(combined_data, 0.8, 0.1, 0.1, 42)

        train_edges = self.split_edge['train']['edge']
        self.train_dataset = Data(
            num_nodes=combined_data.num_nodes,
            x=combined_data.x,
            x0=combined_data.x0,
            edge_index=train_edges
        )

        if self.neg_files:
            self.load_negative_edges()
            for split in ['train', 'valid', 'test']:
                pos_edges = self.split_edge[split]['edge']
                neg_edges = self.split_edge[split]['edge_neg']
                ratio = neg_edges.size(1) / pos_edges.size(1) if pos_edges.size(1) > 0 else 0
                print(f"{split.capitalize()} set:")
                print(f"  Positive edges: {pos_edges.size(1)}")
                print(f"  Negative edges: {neg_edges.size(1)}")
                print(f"  Negative-to-Positive ratio: {ratio:.2f}")
            # 可选打印：正负边数量

        return combined_data



    def process_single(self, root, file_names):
        edges_df = pd.read_csv(os.path.join(root, file_names[0]), sep="\t")
        features_df = pd.read_csv(os.path.join(root, file_names[1]))
        expression_df = pd.read_csv(os.path.join(root, file_names[2]))
        expression_df = expression_df[expression_df['protein.id'].isin(features_df['id'])]
        if file_names[3] is not None:
            turnover_df = pd.read_csv(os.path.join(root, file_names[3]))
            turnover_df = turnover_df[turnover_df['protein.id'].isin(features_df['id'])]
        else:
        # 构造一个全零的 turnover_df
            turnover_df = expression_df.copy()
            turnover_columns = [col for col in turnover_df.columns if col != 'protein.id']
            for col in turnover_columns:
                turnover_df[col] = 0

        # scale to 0-1
        expression_columns = [col for col in expression_df.columns if col != 'protein.id']
        scaler = MinMaxScaler(feature_range=(0, 1))
        expression_df[expression_columns] = scaler.fit_transform(expression_df[expression_columns])
        #scale turnover
        #但如果是全零的就跳过缩放（避免报错）
        turnover_columns = [col for col in turnover_df.columns if col != 'protein.id']
        if not turnover_df[turnover_columns].empty and (turnover_df[turnover_columns].sum().sum() != 0):
            scaler = MinMaxScaler(feature_range=(0, 1))
            turnover_df[turnover_columns] = scaler.fit_transform(turnover_df[turnover_columns])


        # Assign category codes to features_df
        id_cat = pd.Categorical(features_df['id'])
        features_df['id_code'] = id_cat.codes

        # **4. 进行列名映射**
        # 读取当前文件的列名
        file_columns = set(expression_df.columns)

        # 映射表：如果某个列名在 renamed_columns 里，就替换为最终名称
        mapped_columns = {col: col for col in file_columns}  # 默认列名不变
        for final_col, source_cols in self.renamed_columns.items():
            for source_col in source_cols:
                if source_col in file_columns:
                    mapped_columns[source_col] = final_col  # 进行映射

        # **5. 重新命名 expression_df 的列**
        expression_df = expression_df.rename(columns=mapped_columns)
        turnover_df = turnover_df.rename(columns=mapped_columns)

        # **6. 确保最终列顺序与 `final_column` 一致，缺失列填充 0**
        expression_df = expression_df.set_index('protein.id').reindex(columns=self.final_column, fill_value=0).reset_index()
        turnover_df = turnover_df.set_index('protein.id').reindex(columns=self.final_column, fill_value=0).reset_index()


        expression_df['id_code'] = pd.Categorical(expression_df['protein.id'], categories=id_cat.categories).codes
        valid_expression_df = expression_df[expression_df['id_code'] >= 0]

        turnover_df['id_code'] = pd.Categorical(turnover_df['protein.id'], categories=id_cat.categories).codes
        valid_turnover_df = turnover_df[turnover_df['id_code'] >= 0]

        # merge 保证 protein.id 一致，并补充缺失值为 0
        merged_df = pd.merge(valid_expression_df,valid_turnover_df,on='protein.id',how='outer',suffixes=('_expr', '_turn')).fillna(0)  # 缺失补0
        merged_df['id_code'] = pd.Categorical(merged_df['protein.id'], categories=id_cat.categories).codes
        #merged_df = merged_df.drop(['protein.id', 'id_code'], axis=1)

        # 打印前两个 protein.id 对应的 merged_df 行
        print("前两个 protein.id 的 merged_df 内容：")
        print(merged_df[merged_df['protein.id'].isin(merged_df['protein.id'].unique()[:2])])
        print("列名：", merged_df.columns.tolist())

        '''
        # 假设特征列分别是 expression 特征 和 turnover 特征
        expr_cols = [col for col in merged_df.columns if col.endswith('_expr')]
        turn_cols = [col for col in merged_df.columns if col.endswith('_turn')]
        X = merged_df[expr_cols + turn_cols].values  # shape: (num_proteins, num_expr + num_turn)
        '''

        '''
        # Create tensor for expression data
        expression_values_np = valid_expression_df.drop(['protein.id', 'id_code'], axis=1).fillna(0).to_numpy()
        expression_tensor = torch.zeros(
            (len(id_cat.categories), len(self.final_column)), dtype=torch.float
        )
        expression_tensor[valid_expression_df['id_code'].to_numpy()] = torch.as_tensor(expression_values_np, dtype=torch.float)
        '''

         # Create tensor for expression data
        expression_values_np = merged_df.drop(['protein.id', 'id_code','id_code_expr','id_code_turn'], axis=1).fillna(0).to_numpy()
        expression_tensor = torch.zeros(
            (len(id_cat.categories), expression_values_np.shape[1]), dtype=torch.float
        )
        expression_tensor[merged_df['id_code'].to_numpy()] = torch.as_tensor(expression_values_np, dtype=torch.float)

        # **打印 expression feature 相关信息**
        print(f"Expression feature size: {expression_tensor.shape}")  # 形状应为 (num_nodes, num_features)
        print("First two rows of expression features:")
        print(expression_tensor[:2])  # 打印前两行
        print(f"Expression feature column names: {self.final_column}...")  # 仅打印前10个列名

        # Generate or load sequence embeddings
        hdf5_filename = os.path.splitext(file_names[1])[0] + "_embeddings.h5"
        hdf5_path = os.path.join("./TEMP/Seqs", hdf5_filename)

        if os.path.exists(hdf5_path):
            print(f"Loading embeddings from {hdf5_path}...")
            with h5py.File(hdf5_path, "r") as hf:
                features = torch.tensor(hf["embeddings"][:])
        else:
            print(f"No existing embeddings found. Generating embeddings for {file_names[1]}...")
            self._convert_and_save_embeddings(features_df, hdf5_path)
            with h5py.File(hdf5_path, "r") as hf:
                features = torch.tensor(hf["embeddings"][:])



        # Sequence features
        seq_features = features
        node_features = expression_tensor

        # **打印 node feature 相关信息**
        print(f"Node feature size: {node_features.shape}") 
        print(f"seq feature size: {seq_features.shape}")   # 形状应为 (num_nodes, num_features)
        #print("First two rows of node features:")
        #print(node_features[:2])  # 打印前两行
        
        
        # Filter edges to include only proteins in features_df
        edges_df = edges_df[
            edges_df['protein.id.A'].isin(features_df['id']) &
            edges_df['protein.id.B'].isin(features_df['id'])
        ]

        # Create edge index
        edge_index = torch.from_numpy(np.array([
            pd.Categorical(edges_df['protein.id.A'], categories=id_cat.categories).codes,
            pd.Categorical(edges_df['protein.id.B'], categories=id_cat.categories).codes
        ])).long()

        # Add node IDs to the data object
        node_id = torch.tensor(id_cat.codes, dtype=torch.long)

        return Data(x0=seq_features, x=node_features, edge_index=edge_index, node_id=node_id), {idx: protein_id for idx, protein_id in enumerate(features_df['id'])}


    def merge_data(self, data1, data2):
        """
        Merge two datasets by vertically stacking sequence features (x0) and node features (x).
        """

        # Concatenate sequence features (x0) and node features (x)
        seq_features = torch.cat([data1.x0, data2.x0], dim=0)
        node_features = torch.cat([data1.x, data2.x], dim=0)

        # Adjust edge indices for data2
        offset = data1.x.size(0)  # Number of nodes in the first dataset
        data2_edge_index_adjusted = data2.edge_index + offset

        # Concatenate edge indices
        edge_index = torch.cat([data1.edge_index, data2_edge_index_adjusted], dim=1)

        # Calculate the total number of nodes
        num_nodes = data1.x.size(0) + data2.x.size(0)



        # Concatenate sequence features (x0) with node features (x)
        combined_features = torch.cat([seq_features], dim=1)#去掉expression信息 #node_features
        # combined_features = node_features
        
        # 打印 node_features 的前几行
        #print(f"node_features shape: {node_features.shape}")  # 应该是 (num_nodes, 429)
        #print("First few rows of node_features:")
        #print(node_features[:2])  

        # 如果有列名（通常 `x` 是数值矩阵，列名可能需要你自己定义）
        col_names = [f"feature_{i}" for i in range(node_features.shape[1])]
        print(f"Column names (inferred): {col_names[:10]}...")  # 仅打印前10个列名
        print(f"combined_features shape: {combined_features.shape}")  # 检查是否为 (num_nodes, 749)
        return Data(num_nodes=num_nodes, x=combined_features, x0=seq_features, edge_index=edge_index)


    def process_single_data(self, data):
        """
        Process a single dataset, ensuring consistent structure and output.
        """
        # Extract features and edge index from the data
        seq_features = data.x0  # Sequence embeddings
        node_features = data.x  # Node-specific features
        edge_index = data.edge_index

        # Total number of nodes
        num_nodes = node_features.size(0)

        # Concatenate sequence features (x0) with node features (x)
        combined_features = torch.cat([seq_features], dim=1)#node_features

        # Print sizes of all the tensors being returned
        print(f"20250710 Total number of nodes (num_nodes): {num_nodes}")
        print(f"Shape of combined features (x): {combined_features.shape}")
        print(f"Shape of sequence features (x0): {seq_features.shape}")
        print(f"Shape of edge_index: {edge_index.shape}")
        print(f"seq_features shape: {seq_features.shape}")  # 检查是否为 (num_nodes, 320)
        print(f"node_features shape: {node_features.shape}")  # 检查是否为 (num_nodes, 429)
        print(f"combined_features shape: {combined_features.shape}")  # 检查是否为 (num_nodes, 749)

        return Data(num_nodes=num_nodes, x=combined_features, x0=seq_features, edge_index=edge_index)

    '''
    def _convert_and_save_embeddings(self, features_df, hdf5_path, batch_size=8):
        """
        Convert protein sequences to embeddings and save them to an HDF5 file.

        Args:
        - features_df (pd.DataFrame): DataFrame containing protein sequences.
        - hdf5_path (str): Path to save the embeddings HDF5 file.
        """
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        total_sequences = len(features_df)
        max_length = self.max_length
        self.model.to(device).eval()  # 模型移动到 GPU 并设置为评估模式

        total_sequences = len(features_df)

        with h5py.File(hdf5_path, "w") as hf:
            # 创建占位符数据集，总体大小为所有序列数 * embedding 大小
            embeddings_dataset = hf.create_dataset("embeddings", (total_sequences, 320), dtype='float32', chunks=True)

            # **1. 批量处理数据**
            sequences = [seq[:max_length].ljust(max_length, 'X') for seq in features_df['sequence']]
            indices = list(range(total_sequences))
            model = self.model.to(device).eval()  # 确保模型在 eval 模式并放入 GPU
        
            with tqdm(total=total_sequences, desc="Processing sequences", unit="sequence") as pbar:
                for i in range(0, total_sequences, batch_size):
                    batch_indices = indices[i:i + batch_size]
                    batch_sequences = [(str(idx), sequences[idx]) for idx in batch_indices]

                    # **2. batch_converter 一次性转换多个序列**
                    batch_labels, batch_strs, batch_tokens = self.batch_converter(batch_sequences)
                    batch_tokens = batch_tokens.to(device, non_blocking=True)  # **减少显存拷贝时间**

                    with torch.no_grad():
                        with autocast():  # **混合精度计算**
                            repr_layer = len(model.layers) - 1
                            results = model(batch_tokens, repr_layers=[repr_layer])
                            token_representations = results['representations'][repr_layer]

                    # **3. 计算 embedding，减少 GPU → CPU 传输**
                    embeddings = token_representations[:, 1:max_length+1].mean(1).cpu().numpy()

                    # **4. 批量写入 HDF5**
                    for j, seq_idx in enumerate(batch_indices):
                        embeddings_dataset[seq_idx] = embeddings[j]

                    # **5. 清理变量但不调用 empty_cache()**
                    del batch_tokens, results, token_representations
                    pbar.update(len(batch_indices))
            print(f"Embeddings saved to {hdf5_path}.")

    '''

    import torch
    import h5py
    from tqdm import tqdm
    from torch.cuda.amp import autocast

    def _convert_and_save_embeddings(self, features_df, hdf5_path, batch_size=8):
        """
        使用 ESM2 模型将蛋白序列转换为嵌入向量，并保存为 HDF5 文件。

        参数:
        - features_df: 包含 'sequence' 列的 DataFrame，每行为一个蛋白质序列
        - hdf5_path: 输出保存路径 (.h5 文件)
        - batch_size: 批处理大小，建议小于等于 8（ESM2-3B较大）
        """
        device = torch.device("cuda:1" if torch.cuda.is_available() else "cpu")
        self.model.to(device).eval()
        model = self.model
        max_length = self.max_length
        batch_converter = self.batch_converter

        total_sequences = len(features_df)
        embedding_dim = model.embed_dim  # 自动获取模型的输出维度，如 2560

        with h5py.File(hdf5_path, "w") as hf:
            embeddings_dataset = hf.create_dataset(
                "embeddings", 
                (total_sequences, embedding_dim),
                dtype='float32',
                chunks=True  # 启用 chunk 加速写入
            )

            sequences = [seq[:max_length].ljust(max_length, 'X') for seq in features_df['sequence']]
            indices = list(range(total_sequences))

            with tqdm(total=total_sequences, desc="🔄 Processing sequences", unit="seq") as pbar:
                for i in range(0, total_sequences, batch_size):
                    batch_indices = indices[i:i + batch_size]
                    batch_sequences = [(str(idx), sequences[idx]) for idx in batch_indices]

                    # 转换为 token
                    batch_labels, batch_strs, batch_tokens = batch_converter(batch_sequences)
                    batch_tokens = batch_tokens.to(device, non_blocking=True)

                    with torch.no_grad():
                        with autocast():  # 混合精度节省显存
                            repr_layer = len(model.layers) - 1
                            results = model(batch_tokens, repr_layers=[repr_layer])
                            token_representations = results["representations"][repr_layer]

                    # 平均每个序列的 token（不包括[CLS]，取第1到max_length个 token）
                    embeddings = token_representations[:, 1:max_length+1].mean(1).float().cpu().numpy()

                    # 写入每个嵌入向量到 HDF5
                    for j, seq_idx in enumerate(batch_indices):
                        embeddings_dataset[seq_idx] = embeddings[j]

                    del batch_tokens, results, token_representations  # 清理
                    torch.cuda.empty_cache()
                    pbar.update(len(batch_indices))

        print(f"✅ Embeddings saved to {hdf5_path}")


    def len(self):
        return 1

    def _split_edges(self, data, train_ratio=0.8, valid_ratio=0.1, test_ratio=0.1, seed=42):
        """
        Splits the edges into train, validation, and test sets while ensuring:
        - All nodes are included in train, validation, and test sets.
        - Train, valid, and test sets have the same nodes.
        - Test edges are not included in the adjacency matrix (A) to prevent information leakage.
        - SEAL sees only `train_pos` edges during training.

        Args:
        - data (torch_geometric.data.Data): The graph data object containing edges and node features.
        - train_ratio (float): Ratio of edges to use for training.
        - valid_ratio (float): Ratio of edges to use for validation.
        - test_ratio (float): Ratio of edges to use for testing.

        Returns:
        - dict: A dictionary containing train, validation, and test edges with the same node set.
        """

        assert train_ratio + valid_ratio + test_ratio == 1.0, "The sum of train, valid, and test ratios must be 1.0"

        edge_index = data.edge_index
        num_edges = edge_index.size(1)
        num_nodes = data.num_nodes

        # Freeze randomness using a fixed seed
        torch.manual_seed(seed)

        # Shuffle edges
        perm = torch.randperm(num_edges)
        edge_index = edge_index[:, perm]

        # Split indices for train, valid, and test
        num_train_edges = int(num_edges * train_ratio)
        num_valid_edges = int(num_edges * valid_ratio)
        num_test_edges = num_edges - num_train_edges - num_valid_edges

        train_edges = edge_index[:, :num_train_edges]
        valid_edges = edge_index[:, num_train_edges:num_train_edges + num_valid_edges]
        test_edges = edge_index[:, num_train_edges + num_valid_edges:]
        all_nodes = torch.arange(num_nodes)

        return {
            'train': {'edge': train_edges, 'nodes': all_nodes,},
            'valid': {'edge': valid_edges, 'nodes': all_nodes,},
            'test': {'edge': test_edges, 'nodes': all_nodes,},
            'all': {'edge': edge_index, 'nodes': all_nodes,},  # Full dataset
            # 'train_adj': {'edge': adj_train, 'nodes': all_nodes}  # Training adjacency matrix
        }


    def get_edge_split(self):
        return self.split_edge

    '''
    def load_negative_edges(self, chunk_size=100000):
        print('Loading negative edges in chunks...')

        # 定义 HDF5 文件路径
        cache_dir = "./TEMP/negative_edges_cache"
        os.makedirs(cache_dir, exist_ok=True)  # 创建缓存目录
        cache_files = {
            split: os.path.join(cache_dir, f"{split}_negative_edges.h5")
            for split in ['train', 'valid', 'test']
        }


        # 检查是否所有 HDF5 文件都已存在
        if all(os.path.exists(cache_file) for cache_file in cache_files.values()):
            print("All HDF5 cache files found. Loading split negative edges...")

            for split, cache_file in cache_files.items():
                with h5py.File(cache_file, "r") as h5f:
                    # 加载负边
                    
                    loaded_neg_edges = torch.tensor(h5f["edge_neg"][:], dtype=torch.long)
                    num_pos_edges = self.split_edge[split]['edge'].size(1)
                    # num_neg_samples = min(num_pos_edges * 50, loaded_neg_edges.size(1))
                    num_neg_samples = loaded_neg_edges.size(1)

                    # 如果需要，采样负边
                    if num_neg_samples > 0 and num_neg_samples < loaded_neg_edges.size(1):
                        perm = torch.randperm(loaded_neg_edges.size(1))[:num_neg_samples]
                        sampled_neg_edges = loaded_neg_edges[:, perm]
                        print(f"{split.capitalize()} set: Sampled {sampled_neg_edges.size(1)} negative edges from loaded edges.")
                    else:
                        sampled_neg_edges = loaded_neg_edges
                        print(f"{split.capitalize()} set: Using all available {sampled_neg_edges.size(1)} negative edges.")

                    # 更新 split_edge 数据
                    self.split_edge[split]['edge_neg'] = sampled_neg_edges

            return  # 如果所有文件都存在，处理完负边后直接返回


        # 加载 id_to_protein.json 映射
        id_to_protein = self.id_to_protein
        id_to_protein = {int(k): v for k, v in id_to_protein.items()}
        protein_to_id = {v: k for k, v in id_to_protein.items()}

        # 初始化映射后的负边列表
        all_mapped_neg_edges = []

        # 加载负边文件并分批处理
        #mus_neg_file = self.neg_files[0]
        homo_neg_file = self.neg_files[0]

        # 使用 tqdm 跟踪加载和处理的进度
        total_chunks = 0
        for neg_file in [homo_neg_file]:
            total_chunks += sum(1 for _ in pd.read_csv(neg_file, chunksize=chunk_size))

        with tqdm(total=total_chunks, desc="Processing all negative edges", unit="chunk") as pbar:
            for neg_file in [homo_neg_file]:
                print(f"Processing {neg_file} in chunks...")
                chunk_iterator = pd.read_csv(neg_file, chunksize=chunk_size)
                for chunk in chunk_iterator:
                    pbar.update(1)
                    # 确保负边文件包含所需列
                    for name in ['protein.id.A', 'protein.id.B']:
                        if name not in chunk.columns:
                            raise ValueError(f"Columns '{name}' are required in negative edge file.")

                    # 使用向量化操作映射蛋白质 ID 到节点 ID
                    chunk['A_node_id'] = chunk['protein.id.A'].map(protein_to_id)
                    chunk['B_node_id'] = chunk['protein.id.B'].map(protein_to_id)

                    # 过滤映射失败的边（即含有 NaN 的边）
                    valid_neg_edges = chunk.dropna(subset=['A_node_id', 'B_node_id'])
                    valid_neg_edges['A_node_id'] = valid_neg_edges['A_node_id'].astype(int)
                    valid_neg_edges['B_node_id'] = valid_neg_edges['B_node_id'].astype(int)

                    # 将有效的负边添加到总列表中
                    if not valid_neg_edges.empty:
                        all_mapped_neg_edges.append(valid_neg_edges[['A_node_id', 'B_node_id']].values)

        # 将所有映射的负边拼接起来
        if all_mapped_neg_edges:
            combined_neg_edges = np.concatenate(all_mapped_neg_edges, axis=0)
            mapped_neg_edges = torch.tensor(combined_neg_edges.T, dtype=torch.long)
        else:
            mapped_neg_edges = torch.empty((2, 0), dtype=torch.long)

        print(f"\nTotal number of successfully mapped negative edges: {mapped_neg_edges.size(1)}")

        # 处理每个 split
        for split, cache_file in cache_files.items():
            pos_edges = self.split_edge[split]['edge']
            pos_nodes = torch.cat([pos_edges[0], pos_edges[1]]).unique()
            num_pos_edges = pos_edges.size(1)

            # 打印正边节点的信息
            print(f"{split.capitalize()} set: Number of positive edges: {pos_edges.size(1)}")
            print(f"{split.capitalize()} set: Number of unique positive nodes: {pos_nodes.size(0)}")

            # 根据正边节点过滤负边
            src, tgt = mapped_neg_edges[0], mapped_neg_edges[1]
            valid_mask = np.isin(src.cpu().numpy(), pos_nodes.cpu().numpy()) & np.isin(tgt.cpu().numpy(), pos_nodes.cpu().numpy())
            valid_neg_edges = mapped_neg_edges[:, valid_mask]
            print(f"{split.capitalize()} set: Valid negative edges after filtering: {valid_neg_edges.size(1)}")

            # 如果不进行负边采样，则直接使用所有的负边
            sampled_neg_edges = valid_neg_edges
            print(f"{split.capitalize()} set: Using all {sampled_neg_edges.size(1)} negative edges.")

            # 将所有的负边保存到 HDF5 文件
            with h5py.File(cache_file, "w") as h5f:
                h5f.create_dataset("edge_neg", data=sampled_neg_edges.numpy(), compression="lzf")
            print(f"{split.capitalize()} set: Saved {sampled_neg_edges.size(1)} negative edges to {cache_file}.")

            # 更新到内存中的 split_edge
            self.split_edge[split]['edge_neg'] = sampled_neg_edges

        print("All negative edges processed and cached.")
    '''

    def load_negative_edges(self, chunk_size=100000):
        print('🔄 Loading or building negative edges...')

        # 定义缓存路径
        cache_dir = "./TEMP/negative_edges_cache"
        os.makedirs(cache_dir, exist_ok=True)
        cache_files = {
            split: os.path.join(cache_dir, f"{split}_negative_edges.h5")
            for split in ['train', 'valid', 'test']
        }

        # ====== 尝试直接加载所有 split 的缓存 ======
        all_cached = all(os.path.exists(f) for f in cache_files.values())

        if all_cached:
            print("✅ All HDF5 cache files found. Loading split negative edges...")

            for split, cache_file in cache_files.items():
                with h5py.File(cache_file, "r") as h5f:
                    edge_neg = torch.from_numpy(h5f["edge_neg"][:])
                print(f"[{split}] Loaded {edge_neg.size(1)} negative edges from cache.")
                self.split_edge[split]['edge_neg'] = edge_neg

            return  # 🔁 直接加载完成后返回

        # ====== 否则需要重新构建负边 ======
        print("⚠️ Some cache files missing. Regenerating negative edges...")

        # 加载 ID 映射
        id_to_protein = {int(k): v for k, v in self.id_to_protein.items()}
        protein_to_id = {v: k for k, v in id_to_protein.items()}

        all_mapped_neg_edges = []
        neg_file = self.neg_files[0]

        # 统计 chunk 数量用于 tqdm
        total_chunks = sum(1 for _ in pd.read_csv(neg_file, chunksize=chunk_size))

        with tqdm(total=total_chunks, desc="Processing negative edges", unit="chunk") as pbar:
            for chunk in pd.read_csv(neg_file, chunksize=chunk_size):
                pbar.update(1)

                # 校验列名
                for col in ['protein.id.A', 'protein.id.B']:
                    if col not in chunk.columns:
                        raise ValueError(f"Missing required column: {col}")

                chunk['A_node_id'] = chunk['protein.id.A'].map(protein_to_id)
                chunk['B_node_id'] = chunk['protein.id.B'].map(protein_to_id)

                # 去除映射失败的行
                chunk = chunk.dropna(subset=['A_node_id', 'B_node_id'])
                chunk['A_node_id'] = chunk['A_node_id'].astype(int)
                chunk['B_node_id'] = chunk['B_node_id'].astype(int)

                if not chunk.empty:
                    all_mapped_neg_edges.append(chunk[['A_node_id', 'B_node_id']].values)

        # 拼接所有负边
        if all_mapped_neg_edges:
            combined = np.concatenate(all_mapped_neg_edges, axis=0)
            mapped_neg_edges = torch.tensor(combined.T, dtype=torch.long)  # shape: [2, N]
        else:
            mapped_neg_edges = torch.empty((2, 0), dtype=torch.long)

        print(f"✅ Total mapped negative edges: {mapped_neg_edges.size(1)}")

        # 为每个 split 构建负边
        for split, cache_file in cache_files.items():
            pos_edges = self.split_edge[split]['edge']
            pos_nodes = torch.cat([pos_edges[0], pos_edges[1]]).unique()

            src, tgt = mapped_neg_edges[0], mapped_neg_edges[1]
            valid_mask = np.isin(src.cpu().numpy(), pos_nodes.cpu().numpy()) & np.isin(tgt.cpu().numpy(), pos_nodes.cpu().numpy())
            valid_neg_edges = mapped_neg_edges[:, valid_mask]

            print(f"[{split}] Valid negative edges after filtering: {valid_neg_edges.size(1)}")

            # 保存到文件
            with h5py.File(cache_file, "w") as h5f:
                h5f.create_dataset("edge_neg", data=valid_neg_edges.numpy(), compression="lzf")
            print(f"[{split}] Saved {valid_neg_edges.size(1)} negative edges to cache.")

            # 更新到内存
            self.split_edge[split]['edge_neg'] = valid_neg_edges

        print("✅ All splits processed. Negative edges are cached and loaded.")

    def get(self, idx):
        # Lazily process and load the data if it hasn't been done yet
        if self.data is None:
            self.data = self.process_all()
            self.root = '/'.join(self.roots[0].split('/')[:-1]) + '/'
            #self.split_edge = self._split_edges(self.data) 
            # Move split_edges initialization here after data is loaded
        
        
        return self.data



#%%

class CustomDataset_finetune(CustomDataset):
    def __init__(self, roots, file_names_list=None, neg_files_list=None, transform=None,pre_transform=None,
                roots_finetune=None, finetune_file_names_list=None, finetune_neg_files_list=None,
                new_expssion_data=None):
        super(CustomDataset_finetune, self).__init__(roots, file_names_list, neg_files_list, transform, pre_transform)


        self.roots_finetune = roots_finetune
        self.finetune_file_names_list = finetune_file_names_list
        self.finetune_neg_files_list = finetune_neg_files_list
        self.new_expssion_data = new_expssion_data




    def process_all(self):
        # Determine the maximum sequence length before processing datasets
        self.determine_max_length()



        combined_data = None

        # load pretrain data 
        # Process each dataset and merge them
        for root, file_names in zip(self.roots, self.file_names_list):
            data, id_to_protein_single = self.process_single(root, file_names)
            if combined_data is None:
                combined_data = data
                combined_id_to_protein = id_to_protein_single
            else:
                # 在合并数据时，为第二个数据集及后续的数据集的节点编号添加偏移量
                offset = combined_data.x.size(0)  # 第一个数据集的节点数

                # 合并节点特征和边信息
                combined_data = self.merge_data(combined_data, data)

                # 合并 id_to_protein 的映射
                for key, value in id_to_protein_single.items():
                    combined_id_to_protein[key + offset] = value

        self.id_to_protein = combined_id_to_protein

        cache_dir = "./TEMP/id_to_protein_cache"
        os.makedirs(cache_dir, exist_ok=True)
        cache_file = os.path.join(cache_dir, "id_to_protein.json")

        # 将 id_to_protein 保存为缓存文件
        with open(cache_file, "w") as f:
            json.dump(self.id_to_protein, f)
        print(f"id_to_protein mapping saved to {cache_file}")

        # Split edges after processing all data
        self.split_edge = self._split_edges(combined_data,)
        self.split_edge_pretain = self.split_edge
        # self.split


        pretrain_data = combined_data   # Data(num_nodes=num_nodes, x=combined_features, x0=seq_features, edge_index=edge_index)


        # update edges 
        if self.neg_files:
            # Load and integrate negative edges
            self.load_negative_edges()


            for split in ['train', 'valid', 'test',]:
                num_pos_edges = self.split_edge_pretain[split]['edge'].size(1)
                num_neg_edges = self.split_edge_pretain[split]['edge_neg'].size(1)
                ratio = num_neg_edges / num_pos_edges if num_pos_edges > 0 else 0

                print(f"{split.capitalize()} set:")
                print(f"  Positive edges: {num_pos_edges}")
                print(f"  Negative edges: {num_neg_edges}")
                print(f"  Negative-to-Positive ratio: {ratio:.2f}")


        # load finetune data
        
        finetune_data = self.process_finetune(self.roots_finetune[0], self.finetune_file_names_list[0], pretrain_data=pretrain_data)
        #         return Data(x0=seq_features, x=node_features, edge_index=edge_index, node_id=node_id), {idx: protein_id for idx, protein_id in enumerate(features_df['id'])}

        return finetune_data




    def process_finetune(self, root, file_names, pretrain_data):
        
        pretrain_seq_feature = pretrain_data.x0  # processed
        protein_to_id = {v: k for k, v in self.id_to_protein.items()}  # 蛋白质ID到索引的映射
    

        edges_df = pd.read_csv(os.path.join(root, file_names[0]), sep="\t")
        # features_df = pd.read_csv(os.path.join(root, file_names[1]))
        expression_df = pd.read_csv(os.path.join(root, file_names[2]))


        # 1. 加载微调基础数据 (data2)
        base_finetune_file = os.path.join(root, file_names[2])
        print(f"加载微调基础数据(data2): {base_finetune_file}")
        finetune_df = pd.read_csv(base_finetune_file)
    
    
        # 2. 如果有新数据(data3)，进行层级覆盖
        if self.new_expssion_data is not None:
            print(f"加载新数据(data3): {self.new_expssion_data}")
            new_data_df = pd.read_csv(self.new_expssion_data)
            
            # 确保新数据有必要的列
            if 'protein.id' not in new_data_df.columns:
                raise ValueError("新的表达数据中缺少'protein.id'列")
            
            # 获取蛋白质ID集合
            finetune_proteins = set(finetune_df['protein.id'])
            new_data_proteins = set(new_data_df['protein.id'])
            
            # 找出仅在finetune数据中有的蛋白质
            only_in_finetune = finetune_proteins - new_data_proteins
            
            # 打印覆盖信息
            print(f"微调数据中有{len(finetune_proteins)}个蛋白质")
            print(f"新数据中有{len(new_data_proteins)}个蛋白质")
            print(f"有{len(only_in_finetune)}个蛋白质仅在微调数据中，将被保留")
            print(f"新数据将覆盖{len(finetune_proteins & new_data_proteins)}个微调数据中的蛋白质")
            
            # 保留仅在finetune中的行
            finetune_only_rows = finetune_df[finetune_df['protein.id'].isin(only_in_finetune)]
            
            # 合并新数据和仅在finetune中的行
            expression_df = pd.concat([new_data_df, finetune_only_rows], ignore_index=True)
            print(f"合并后的数据包含{len(expression_df)}行")
        else:
            # 如果没有新数据，直接使用微调数据
            expression_df = finetune_df



        # Filter for proteins in features_df
        # expression_df = expression_df[expression_df['protein.id'].isin(features_df['id'])]
        expression_nodes = expression_df['protein.id'].unique().tolist()


        missing_nodes = [pid for pid in expression_nodes if pid not in protein_to_id]
        if missing_nodes:
            print(f"发现{len(missing_nodes)}个未在预训练中的蛋白质ID，示例：{missing_nodes[:5]}")
            # raise ValueError(f"发现{len(missing_nodes)}个未在预训练中的蛋白质ID，示例：{missing_nodes[:5]}")
    
        valid_expression_nodes = [pid for pid in expression_nodes if pid in protein_to_id]
        expression_nodes = valid_expression_nodes


        expression_df = expression_df[expression_df['protein.id'].isin(expression_nodes)]



        # 批量获取索引和序列特征
        indices = [protein_to_id[pid] for pid in expression_nodes]
        seq_features = pretrain_seq_feature[indices].cpu().numpy()  # shape [N, 320]
    

        # 创建排序映射字典
        order_dict = {pid: idx for idx, pid in enumerate(expression_nodes)}
    
        # 添加临时排序列
        expression_df['_sort_key'] = expression_df['protein.id'].map(order_dict)
    
        # 排序并去重（保留第一个出现的记录）
        sorted_expression = expression_df.sort_values('_sort_key').drop_duplicates('protein.id', keep='first')
        # 验证排序正确性
        assert (sorted_expression['protein.id'] == expression_nodes).all(), "表达数据排序失败"

        expression_df = sorted_expression

        # 构建特征DataFrame
        featuresid_df = pd.DataFrame({
            'id': expression_nodes,
            'pretrain_idx': indices
        })

        # scale to 0-1
        expression_columns = [col for col in expression_df.columns if col != 'protein.id']
        scaler = MinMaxScaler(feature_range=(0, 1))
        expression_df[expression_columns] = scaler.fit_transform(expression_df[expression_columns])

        
        # Assign category codes to features_df
        id_cat = pd.Categorical(featuresid_df['id'])
        featuresid_df['id_code'] = id_cat.codes


        # Ensure consistent column names
        file_columns = set(expression_df.columns)
        mapped_columns = {col: col for col in file_columns}  # Default to same names
        for final_col, source_cols in self.renamed_columns.items():
            for source_col in source_cols:
                if source_col in file_columns:
                    mapped_columns[source_col] = final_col  # Apply mapping
        expression_df = expression_df.rename(columns=mapped_columns)


        # Ensure final column order
        expression_df = expression_df.set_index('protein.id').reindex(columns=self.final_column, fill_value=0).reset_index()

        # Add id_code to expression_df for alignment
        expression_df['id_code'] = pd.Categorical(expression_df['protein.id'], categories=id_cat.categories).codes
        valid_expression_df = expression_df[expression_df['id_code'] >= 0]
        
        # ==== 2. 加载或构造 turnover_df ====
        is_turnover_all_zero = False
        if len(file_names) > 3 and file_names[3] is not None:
            turnover_file = os.path.join(root, file_names[3])
            print(f"加载 turnover 数据: {turnover_file}")
            turnover_df = pd.read_csv(turnover_file)

        # 对齐 protein.id
            turnover_df = turnover_df[turnover_df['protein.id'].isin(valid_expression_df['protein.id'])]
            turnover_df['_sort_key'] = turnover_df['protein.id'].map(order_dict)
            turnover_df = turnover_df.sort_values('_sort_key').drop_duplicates('protein.id', keep='first')
            assert (turnover_df['protein.id'].tolist() == valid_expression_df['protein.id'].tolist()), "turnover 排序失败"

        # 获取特征列并进行缩放
            turnover_columns = [col for col in turnover_df.columns if col != 'protein.id']
            turn_scaler = MinMaxScaler(feature_range=(0, 1))
            turnover_df[turnover_columns] = turn_scaler.fit_transform(turnover_df[turnover_columns])
        else:
            print("未提供 turnover 数据，使用全 0 矩阵（不缩放）")
            turnover_df = valid_expression_df.copy()
            turnover_columns = [col for col in turnover_df.columns if col != 'protein.id']
            for col in turnover_columns:
                turnover_df[col] = 0.0
            is_turnover_all_zero = True

        # ==== 3. 合并 valid_expression_df + turnover_df ====
        merged_df = pd.merge(valid_expression_df, turnover_df, on='protein.id', how='inner', suffixes=('_expr', '_turn'))

        #expr_cols = [c for c in merged_df.columns if c.endswith('_expr')]
        #turn_cols = [c for c in merged_df.columns if c.endswith('_turn')]
        expr_cols = [c for c in merged_df.columns if c.endswith('_expr') and c != 'id_code_expr']
        turn_cols = [c for c in merged_df.columns if c.endswith('_turn') and c != 'id_code_turn']
        all_feature_cols = expr_cols + turn_cols

        # ==== 4. 构造 tensor ====
        merged_df['id_code'] = pd.Categorical(merged_df['protein.id'], categories=id_cat.categories).codes
        valid_df = merged_df[merged_df['id_code'] >= 0]
        
        #expression_values_np = valid_df.drop(['protein.id', 'id_code','id_code_expr','id_code_turn'], axis=1).fillna(0).to_numpy()
        expression_values_np = valid_df[all_feature_cols].to_numpy()
        expression_values_np = np.nan_to_num(expression_values_np, nan=0.0)  
        
        
        expression_tensor = torch.zeros(
           (len(id_cat.categories), len(all_feature_cols)), dtype=torch.float
        )
        expression_tensor[valid_df['id_code'].to_numpy()] = torch.as_tensor(expression_values_np, dtype=torch.float)

        '''
        # Create tensor for expression data
        expression_values_np = valid_expression_df.drop(['protein.id', 'id_code'], axis=1).fillna(0).to_numpy()
        expression_tensor = torch.zeros(
            (len(id_cat.categories), len(self.final_column)), dtype=torch.float
        )
        expression_tensor[valid_expression_df['id_code'].to_numpy()] = torch.as_tensor(expression_values_np, dtype=torch.float)
        '''



        # **打印 expression feature 相关信息**
        print(f"Expression feature size: {expression_tensor.shape}")  # 形状应为 (num_nodes, num_features)
        print("First two rows of expression features:")
        print(expression_tensor[:2])  # 打印前两行
        print(f"Expression feature column names: {self.final_column}...")  # 仅打印前10个列名




        # Sequence features
        seq_features = torch.tensor(seq_features, dtype=torch.float32, device=pretrain_data.x.device)
        node_features = expression_tensor
        print("fintune-✅ seq_features shape:", seq_features.shape)
        print("✅ node_features shape:", node_features.shape)


        # Map finetune_data proteins to pretrain_data ids
        
        finetune_indices_in_pretrain = featuresid_df['pretrain_idx']

        assert len(finetune_indices_in_pretrain) == len(expression_nodes), "finetune_data contains unknown proteins"


        # Update pretrain_data.x          # Concatenate sequence features (x0) with node features (x)
        # combined_features = torch.cat([seq_features, node_features], dim=1)
        pretrain_data.x = torch.zeros(pretrain_data.num_nodes, 2560, device=seq_features.device) #0708
        pretrain_data.x[finetune_indices_in_pretrain] = torch.cat([seq_features], dim=1)#, node_features
        # combine——feature zheliyeyaogei
        # pretrain_data.x[finetune_indices_in_pretrain] = node_features  # require combined_feature



        # Map finetune_data edges to pretrain_data indices
        finetune_edge_index = torch.from_numpy(np.array([
            [protein_to_id[p] for p in edges_df['protein.id.A']],
            [protein_to_id[p] for p in edges_df['protein.id.B']]
        ])).long()

        # Create data (finetune only)
        data = Data(
            num_nodes=pretrain_data.num_nodes,
            x0=pretrain_data.x0,
            x=pretrain_data.x,
            edge_index=finetune_edge_index,  # including all
        )  #         return Data(num_nodes=num_nodes, x=combined_features, x0=seq_features, edge_index=edge_index)



        self.split_edge_finetune = self._split_edges(data,)



        
        if self.finetune_neg_files_list:
            # Load and integrate negative edges
            self.load_finetune_negative_edges()


            for split in ['train', 'valid', 'test',]:
                num_pos_edges = self.split_edge_finetune[split]['edge'].size(1)
                num_neg_edges = self.split_edge_finetune[split]['edge_neg'].size(1)
                ratio = num_neg_edges / num_pos_edges if num_pos_edges > 0 else 0

                print(f"{split.capitalize()} set:")
                print(f"  Positive edges: {num_pos_edges}")
                print(f"  Negative edges: {num_neg_edges}")
                print(f"  Negative-to-Positive ratio: {ratio:.2f}")


        self.data_finetune = data

        # Create data_graph (pretrain + finetune)
        all_edge_index = torch.cat([pretrain_data.edge_index, finetune_edge_index], dim=1)
        train_edges = torch.cat([self.split_edge['train']['edge'], self.split_edge_finetune['train']['edge']], dim=1)
        valid_edges = self.split_edge_finetune['valid']['edge']
        test_edges = self.split_edge_finetune['test']['edge']
        # all_edges =  torch.cat([self.split_edge['all']['edge'], finetune_edge_index['all']['edge']], dim=1)
        # 'all': {'edge': edge_index, 'nodes': all_nodes},
        self.split_edge_graph = {
                    "train": {"edge": train_edges},
                    "valid": {"edge": valid_edges},
                    "test": {"edge": test_edges},
                    "all":{"edge":torch.cat([train_edges, self.split_edge['valid']['edge'], valid_edges, self.split_edge['test']['edge'], test_edges], dim=1)}
                }

        self.data_graph = Data(
            num_nodes=pretrain_data.num_nodes,
            x0=pretrain_data.x0,
            x=pretrain_data.x,
            edge_index=all_edge_index,
            
        ) 



        # for build graph
        self.train_dataset = Data(
                num_nodes=self.data_graph.num_nodes,  # 节点数不变
                x=self.data_graph.x,  # 继承节点特征
                x0=self.data_graph.x0,  # 继承序列特征
                edge_index=train_edges  # 只包含训练边
            )


        # # Filter edges to include only proteins in features_df
        # edges_df = edges_df[
        #     edges_df['protein.id.A'].isin(features_df['id']) &
        #     edges_df['protein.id.B'].isin(features_df['id'])
        # ]


        return self.data_finetune 

    def get_graph_dataset(self):
        return self.data_graph
    
    
    def get_edge_split(self):
        return self.split_edge_finetune
        




    def load_finetune_negative_edges(self, chunk_size=100000):
        """
        Load negative edges from given files in batches, split them into train/valid/test sets,
        and save each split in a separate HDF5 file.

        Args:
        - chunk_size (int): Size of each chunk to be processed.

        Updates:
        - self.split_edge: Adds negative edges ('edge_neg') for each split.
        """
        print('Loading negative edges in chunks...')

            # 定义 HDF5 缓存目录
        cache_dir = "./TEMP/negative_edges_finetune_cache"
        os.makedirs(cache_dir, exist_ok=True)  # 确保目录存在
        cache_files = {
            split: os.path.join(cache_dir, f"{split}_finetune_negative_edges.h5")
            for split in ['train', 'valid', 'test']
        }
        '''
        id_to_protein = self.id_to_protein
        id_to_protein = {int(k): v for k, v in id_to_protein.items()}  # key转int
        protein_to_id = {v: k for k, v in id_to_protein.items()}  # 反向映射
        '''
        
        # 检查是否所有 HDF5 文件都已存在
        if all(os.path.exists(cache_file) for cache_file in cache_files.values()):
            print("All HDF5 cache files found. Loading split negative edges...")

            for split, cache_file in cache_files.items():
                with h5py.File(cache_file, "r") as h5f:
                    # 加载负边
                    loaded_neg_edges = torch.tensor(h5f["edge_neg"][:], dtype=torch.long)
                    num_pos_edges = self.split_edge_finetune[split]['edge'].size(1)
                    # num_neg_samples = min(num_pos_edges * 50, loaded_neg_edges.size(1))   # 10 time pos
                    num_neg_samples = loaded_neg_edges.size(1)

                    # 如果需要，采样负边
                    if num_neg_samples > 0 and num_neg_samples < loaded_neg_edges.size(1):
                        perm = torch.randperm(loaded_neg_edges.size(1))[:num_neg_samples]
                        sampled_neg_edges = loaded_neg_edges[:, perm]
                        print(f"{split.capitalize()} set: Sampled {sampled_neg_edges.size(1)} negative edges from loaded edges.")
                    else:
                        sampled_neg_edges = loaded_neg_edges
                        print(f"{split.capitalize()} set: Using all available {sampled_neg_edges.size(1)} negative edges.")
            
                    # 更新 split_edge_finetune 数据
                    self.split_edge_finetune[split]['edge_neg'] = sampled_neg_edges
                   
                     # 在这里加打印
                        # --- 这里开始 ---
                    #edge_sample = sampled_neg_edges[:, :10].cpu().numpy()
                    #src_ids = edge_sample[0]
                    #dst_ids = edge_sample[1]
                    #src_proteins = [id_to_protein.get(int(idx), f"UNK_{idx}") for idx in src_ids]
                    #dst_proteins = [id_to_protein.get(int(idx), f"UNK_{idx}") for idx in dst_ids]

                    #print(f"{split.capitalize()} set first 10 negative edges (protein IDs):")
                    #for s, d in zip(src_proteins, dst_proteins):
                    #    print(f"{s} -- {d}")
                    # --- 这里结束 ---
                    
            return  0 # 如果所有文件都存在，处理完负边后直接返回

            
        # **2. 读取 self.id_to_protein 进行映射**
        id_to_protein = self.id_to_protein
        id_to_protein = {int(k): v for k, v in id_to_protein.items()}  # 确保 key 是 int
        protein_to_id = {v: k for k, v in id_to_protein.items()}  # 反向映射 {protein_id -> index}

        # **3. 读取 finetune 负边文件**
        finetune_neg_file = self.finetune_neg_files_list[0]  # 你的文件路径
        all_mapped_neg_edges = []  # 存储所有负边



        # **4. 使用 tqdm 处理负边**
        total_chunks = sum(1 for _ in pd.read_csv(finetune_neg_file, chunksize=chunk_size))
        with tqdm(total=total_chunks, desc="Processing finetune negative edges", unit="chunk") as pbar:
            for chunk in pd.read_csv(finetune_neg_file, chunksize=chunk_size):
                pbar.update(1)
                # **确保负边文件包含所需列**
                if 'protein.id.A' not in chunk.columns or 'protein.id.B' not in chunk.columns:
                    raise ValueError("Columns 'protein.id.A' and 'protein.id.B' are required in the negative edge file.")

                # **映射蛋白 ID 到 pretrain 的 ID**
                chunk['A_node_id'] = chunk['protein.id.A'].map(protein_to_id)
                chunk['B_node_id'] = chunk['protein.id.B'].map(protein_to_id)

                # **过滤映射失败的边**
                valid_neg_edges = chunk.dropna(subset=['A_node_id', 'B_node_id'])
                valid_neg_edges['A_node_id'] = valid_neg_edges['A_node_id'].astype(int)
                valid_neg_edges['B_node_id'] = valid_neg_edges['B_node_id'].astype(int)

                # **存储有效的负边**
                if not valid_neg_edges.empty:
                    all_mapped_neg_edges.append(valid_neg_edges[['A_node_id', 'B_node_id']].values)

        # **5. 转换负边格式**
        if all_mapped_neg_edges:
            combined_neg_edges = np.concatenate(all_mapped_neg_edges, axis=0)
            mapped_neg_edges = torch.tensor(combined_neg_edges.T, dtype=torch.long)
        else:
            mapped_neg_edges = torch.empty((2, 0), dtype=torch.long)

        print(f"\nTotal number of successfully mapped finetune negative edges: {mapped_neg_edges.size(1)}")


        # **6. 处理 train/valid/test**
        for split, cache_file in cache_files.items():
            pos_edges = self.split_edge_finetune[split]['edge']
            pos_nodes = torch.cat([pos_edges[0], pos_edges[1]]).unique()
            num_pos_edges = pos_edges.size(1)

            print(f"{split.capitalize()} set (Finetune): Number of positive edges: {num_pos_edges}")
            print(f"{split.capitalize()} set (Finetune): Number of unique positive nodes: {pos_nodes.size(0)}")

            # **过滤负边**
            src, tgt = mapped_neg_edges[0], mapped_neg_edges[1]
            valid_mask = np.isin(src.cpu().numpy(), pos_nodes.cpu().numpy()) & np.isin(tgt.cpu().numpy(), pos_nodes.cpu().numpy())
            valid_neg_edges = mapped_neg_edges[:, valid_mask]
            print(f"{split.capitalize()} set (Finetune): Valid negative edges after filtering: {valid_neg_edges.size(1)}")

            # **直接使用所有的负边**
            sampled_neg_edges = valid_neg_edges
            print(f"{split.capitalize()} set (Finetune): Using all {sampled_neg_edges.size(1)} negative edges.")

            # **7. 存储负边**
            with h5py.File(cache_file, "w") as h5f:
                h5f.create_dataset("edge_neg", data=sampled_neg_edges.numpy(), compression="lzf")
            print(f"{split.capitalize()} set (Finetune): Saved {sampled_neg_edges.size(1)} negative edges to {cache_file}.")

            # **更新 self.split_edge_finetune**
            self.split_edge_finetune[split]['edge_neg'] = sampled_neg_edges

        print("All finetune negative edges processed and cached.")






#%%

def load_localdata():

    # Check available GPUs
    print("Available GPUs:", torch.cuda.device_count())

    
    # 单独加在人类的数据集
    homo_files = ['20250703_homo_positive_pair.txt', 'homo_node-20250117.csv', 'Homo-7T_1-10-20240731.csv',None]
    neg_files = ["dataset/custom_ppi/negative_gt/20250703_homo_negative_pair.csv"]
    dataset = CustomDataset(roots=['dataset/custom_ppi/Homo'],   #'dataset/custom_ppi/Homo'  roots=['dataset/custom_ppi/Mus','dataset/custom_ppi/Homo']
                        file_names_list=[homo_files], neg_files_list = neg_files)
    data = dataset[0]   
    '''
   # 单独加在小鼠的数据集
    mus_files = ['connection_mus-20240805.txt', 'mus_node-20250117.csv', 'Mus-7T_1-10-20240731.csv','turnover_20250515.csv']
    neg_files = ["dataset/custom_ppi/negative_gt/Mus_negative-20241005.csv"]
    dataset = CustomDataset(roots=['dataset/custom_ppi/Mus'],   #'dataset/custom_ppi/Homo'  roots=['dataset/custom_ppi/Mus','dataset/custom_ppi/Homo']
                        file_names_list=[mus_files], neg_files_list = neg_files)
    '''
    data = dataset[0]   

    print("Total number of nodes (size of features):", data.x.size())

    #print("First edges:")
    print(data.edge_index[:, :3])
    print("Total number of edges (size of edge index):", data.edge_index.size())



    # 打印节点和边的相关信息
    print("Total number of nodes (size of features):", data.x.size(0))
    print("First edges:", data.edge_index[:, :3])
    print("Total number of edges (size of edge index):", data.edge_index.size(1))
    # print('nodeid', data.node_id[:3])
    # print('nodeid', data.node_id[ -4:])
    print('node indices:', data.x[:, :3])
    print('node indices:', data.x[:, -5:])


    # 打印节点和边的相关信息
    print("Total number of nodes (size of features):", data.x.size(0))
    print("First edges:", data.edge_index[:, :3])
    print("Total number of edges (size of edge index):", data.edge_index.size(1))
    print('nodeid', data.num_nodes)
    # print('nodeid', data.num_nodes[ -4:])
    print('node indices:', data.x[:, :3])
    print('node indices:', data.x[:, -5:])
    # Check max node ID in edge_index
    max_node_id_in_edges = data.edge_index.max().item()
    print("Maximum node ID in edges:", max_node_id_in_edges)


    #split_edge = dataset.get_edge_split() 

    
    #print(split_edge['train'].keys())
    print(dataset.root)
    print("Dataset root directory:", dataset.root)

    return dataset 


def load_finetune_localdata(new_expssion_data = None):

    # Check available GPUs
    print("Available GPUs:", torch.cuda.device_count())
 
    print('using new data.')
   #加载人类
    homo_files = ['20250703_homo_positive_pair.txt', 'homo_node-20250117.csv', 'Homo-7T_1-10-20240731.csv',None]
    neg_files = ["dataset/custom_ppi/negative_gt/20250703_homo_negative_pair.csv"]
    homo_finetune_file = ['20250705_finetune_homo_positive_pair.txt', 'homo_node-20250117.csv', 'homo_exp.csv',None ]
    neg_finetune_file = ['dataset/custom_ppi/negative_gt/20250705_finetune_homo_negative_pair.csv'] 
    #mus_finetune_file = ['02.connection_MT22_positive-20241206.txt', '03.MT22_node-20241207.csv', 'DIANN1.8.1Re-Old.pg_matrix_processed_v3.csv', ]
    #neg_finetune_file = ['dataset/custom_ppi/finetune_data/MT22/04.connection_MT22_negative-20241207.csv'] 
    dataset = CustomDataset_finetune(roots=['dataset/custom_ppi/Homo'],
                                    file_names_list=[homo_files], neg_files_list = neg_files, transform=None,pre_transform=None,
                                    roots_finetune=['dataset/custom_ppi/fintune_homo'], 
                                    finetune_file_names_list=[homo_finetune_file], finetune_neg_files_list=neg_finetune_file,
                                    new_expssion_data = new_expssion_data)
    
    '''
    #加载小鼠
    mus_files = ['connection_mus-20240805.txt', 'mus_node-20250117.csv', 'Mus-7T_1-10-20240731.csv','turnover_20250515.csv']
    neg_files = ["dataset/custom_ppi/negative_gt/Mus_negative-20241005.csv"]
    mus_finetune_file = ['raw_22T_positive_pair.txt', 'raw_22T_node_sequences.csv', 'raw_22T_exp.csv',None]
    neg_finetune_file = ['dataset/custom_ppi/5_14_finetune_22T/raw_22T_negative_pair.csv']  


    dataset = CustomDataset_finetune(roots=['dataset/custom_ppi/Mus'],
                                    file_names_list=[mus_files], neg_files_list = neg_files, transform=None,pre_transform=None,
                                    roots_finetune=['dataset/custom_ppi/5_14_finetune_22T'], 
                                    finetune_file_names_list=[mus_finetune_file], finetune_neg_files_list=neg_finetune_file,
                                    new_expssion_data = new_expssion_data)
    '''
    data = dataset[0] 
    print("Dataset root directory:", dataset.root)
    return dataset 


