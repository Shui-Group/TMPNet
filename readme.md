# TMPNet

**Proteomics-informed prediction of a tissue-wide endogenous transmembrane protein association network**

- **Code:** https://github.com/Shui-Group/TMPNet
- **Data and model files:** https://doi.org/10.5281/zenodo.21640085

## Overview

TMPNet integrates protein language model-derived sequence embeddings with tissue-resolved proteomic signatures to infer transmembrane protein (TMP) associations that are shared across tissues or enriched in specific tissues. Using a TMP-focused tissue proteome map, the framework predicted 137,510 high-confidence TMP associations and constructed an endogenous human TMP association network termed **TMPNet**.

TMPNet consists of three components:

1. **Sequence-based model:** graph-based link prediction using ESM-2-derived protein representations.
2. **Proteomics-informed model:** XGBoost prediction using tissue-resolved proteomic features.
3. **Fusion framework:** logistic-regression integration of the sequence-based and proteomics-informed scores.

![TMPNet workflow](docs/TMPNet_workflow.png)

## Repository contents

```text
TMPNet/
├── README.md
├── LICENSE
├── environment.yml
├── docs/
│   └── TMPNet_workflow.png
├── example/
│   ├── DL_dataset/custom_ppi_example
│   ├── DL_result/finetune_custom_ppi_20260411144432
│   └── Fusion
│   └── ML
├── scripts/
│   ├── 01_data_preprocessing/
│   ├── 02_feature_generation/
│   ├── 03_model_training/
│   ├── 04_TMPNet_construction/
```

The repository contains a small example dataset that can be used to examine the required input format and test the analysis workflow. It also contains an example fine-tuned model checkpoint and the files required to demonstrate the proteomics-informed and fusion-model analyses.

The example files are intended for software testing and workflow demonstration rather than reproduction of the complete TMPNet network. Large files, including the complete datasets, precomputed protein sequence embeddings and full trained model checkpoints, are distributed separately through Zenodo as described in the Data and pretrained models section.

## Installation

TMPNet has been tested on Ubuntu 24.04.2 LTS with Python 3.9.21, PyTorch 2.6.0 and CUDA 12.4. The exact dependency versions are recorded in `environment.yml`.

On a desktop computer running Ubuntu 24.04 with an 8-core CPU, 32 GB of RAM and a standard broadband connection, cloning the repository and creating the Conda environment typically takes approximately 30 min.

```bash
git clone https://github.com/Shui-Group/TMPNet.git
cd TMPNet
conda env create -f environment.yml
conda activate TMPNet
```

Verify the installation:

```bash
python scripts/03_model_training/01_sequence_based_model/DL_model_seal_link_pred.py -h
```

## Data and pretrained models

Large files are distributed through Zenodo:

> https://doi.org/10.5281/zenodo.21640085

For **inference**, download the trained checkpoints for:

- the sequence-based model;
- the proteomics-informed model;
- the fusion model.

For **retraining**, also download:

- the protein sequence FASTA file;
- the precomputed ESM-2 3B embeddings;
- the generic PPI pretraining checkpoint;
- the TMP-specific fine-tuning checkpoint;
- the proteomics-informed model checkpoint;
- the fusion framework checkpoint;

Place the downloaded ESM-2 3B embedding files in:

```text
/example/TEMP/esm_model/
```

Precomputed ESM-2 3B embeddings are recommended because regenerating them requires substantial computational time and GPU memory.

Place the downloaded sequence-based model checkpoint files in:

```text
/example/DL_result/finetune_custom_ppi_20260411144433/
```

Place the downloaded proteomics-informed model checkpoint and fusion framework checkpoint files in:

```text
/example/checkpoint/
```

## Usage

Example inputs are provided in `example/`. Replace all example paths with the paths to your own data.
Using the example dataset, pretrained checkpoints and precomputed ESM-2 embeddings, the complete inference demo takes approximately 40-60 min on a desktop computer with an 8-core CPU and 32 GB of RAM. This estimate excludes installation, data download, embedding generation and model retraining.

### 1. Sequence-based model

#### Input

Example file:

```text
example/DL_dataset/custom_ppi_example
```

#### Inference

```bash
TMP_DATASET="finetune_custom_ppi"
NUM_WORKERS=32
NUM_SUBDATASETS=1
NUM_HOPS=1
EVAL_STEPS=1
RUNS=1
TRAIN_PERCENT=100

FINETUNED_MODEL="example/DL_result/finetune_custom_ppi_20260411144433/DL_model_finetune.pth"
INFERENCE_BATCH_SIZE=32
INFERENCE_EPOCHS=751
INFERENCE_CONTINUE_FROM=50

python scripts/03_model_training/01_sequence_based_model/ \
  --dataset "${TMP_DATASET}" \
  --only_pred_finetunenodes \
  --num_workers "${NUM_WORKERS}" \
  --num_subdatasets "${NUM_SUBDATASETS}" \
  --continue_from "${INFERENCE_CONTINUE_FROM}" \
  --resume_dir "${FINETUNED_MODEL}" \
  --batch_size "${INFERENCE_BATCH_SIZE}" \
  --num_hops "${NUM_HOPS}" \
  --use_feature \
  --dynamic_train \
  --dynamic_val \
  --dynamic_test \
  --eval_steps "${EVAL_STEPS}" \
  --runs "${RUNS}" \
  --epochs "${INFERENCE_EPOCHS}" \
  --train_percent "${TRAIN_PERCENT}"
```

Output: results/custom_ppi_[TIMESTAMP]/

#### Pretraining on the generic PPI dataset

```bash
NUM_WORKERS=32
NUM_SUBDATASETS=1
NUM_HOPS=1
EVAL_STEPS=1
RUNS=1
TRAIN_PERCENT=100

GENERIC_DATASET="custom_ppi"
PRETRAIN_BATCH_SIZE=128
PRETRAIN_EPOCHS=150

python scripts/03_model_training/01_sequence_based_model/ \
  --dataset "${GENERIC_DATASET}" \
  --num_workers "${NUM_WORKERS}" \
  --num_subdatasets "${NUM_SUBDATASETS}" \
  --batch_size "${PRETRAIN_BATCH_SIZE}" \
  --num_hops "${NUM_HOPS}" \
  --use_feature \
  --dynamic_train \
  --dynamic_val \
  --dynamic_test \
  --eval_steps "${EVAL_STEPS}" \
  --runs "${RUNS}" \
  --epochs "${PRETRAIN_EPOCHS}" \
  --train_percent "${TRAIN_PERCENT}"
```

Expected result directory:

```text
results/custom_ppi_[TIMESTAMP]/
```

#### Fine-tuning on the TMP PPI dataset

```bash
TMP_DATASET="finetune_custom_ppi"
PRETRAINED_RUN_DIR="/example/DL_result/finetune_custom_ppi_20260411144433" #pretrain model checkpoint path
FINETUNE_BATCH_SIZE=128
FINETUNE_EPOCHS=100
FINETUNE_CONTINUE_FROM=100

python scripts/03_model_training/01_sequence_based_model/ \
  --dataset "${TMP_DATASET}" \
  --num_workers "${NUM_WORKERS}" \
  --num_subdatasets "${NUM_SUBDATASETS}" \
  --continue_from "${FINETUNE_CONTINUE_FROM}" \
  --resume_dir "${PRETRAINED_RUN_DIR}" \
  --batch_size "${FINETUNE_BATCH_SIZE}" \
  --num_hops "${NUM_HOPS}" \
  --use_feature \
  --dynamic_train \
  --dynamic_val \
  --dynamic_test \
  --eval_steps "${EVAL_STEPS}" \
  --runs "${RUNS}" \
  --epochs "${FINETUNE_EPOCHS}" \
  --train_percent "${TRAIN_PERCENT}"
```

Expected checkpoint:

```text
results/custom_ppi_[TIMESTAMP]/DL_model_finetune.pth
```


### 2. Proteomics-informed model

The proteomics-informed model calculates pairwise features from tissue-resolved protein-abundance profiles and applies a trained XGBoost classifier.

#### Input

Example file:

```text
example/ML/input
```
#### Feature generation

To generate tissue-context features from protein abundance profiles, run:

```bash
scripts/02_feature_generation/proteomics_informed_model_feature_generation.py
```

Test output: `example/ML/output/total_features.csv`.

#### Training

```bash
scripts/03_model_training/02_proteomics_informed_XGB.py
```

#### Inference

```bash
scripts/04_TMPNet_construction/02_ML_model_infer.py
```

Output: `example/ML/output/XGB_1v9_prediction.csv`.

### 3. Fusion framework

The fusion model combines the sequence-based and proteomics-informed prediction scores using logistic regression.

#### Input

Example file:

```text
example/Fusion/inference.csv
```

Required columns:

| Column | Description |
|---|---|
| `DL_score` | Sequence-based prediction score |
| `ML_score` | Proteomics-informed prediction score |

The two prediction scores are merged based on the corresponding protein-pair identifier.

Protein pairs were matched using unordered protein pairs, where (A, B) and (B, A) were considered equivalent. The merge key was generated from the two protein identifiers after sorting them alphabetically. 

#### Inference

```bash
scripts/04_TMPNet_construction/03_fusion_model_infer.py
```

Final output: `example/Fusion/output.csv`.

The final output contains the following columns:

| Column | Description |
|---|---|
| `DL_score` | Sequence-based prediction score |
| `ML_score` | Proteomics-informed prediction score |
| `Fusion_Pred_Prob` | Final TMPNet association probability |

A higher `Fusion_Pred_Prob` indicates a higher predicted probability of a tissue-contextual protein–protein association. The high-confidence prediction threshold is 0.84.

#### Training

```bash
python scripts/03_model_training/03_Fusion_model.py
```

## Reproducibility information

Before release, provide:

- dataset versions and accessions;
- exact input and checkpoint filenames in the Zenodo record;
- release tag or commit hash corresponding to the manuscript;
- random seeds;
- training/validation/test split strategy;
- model-selection metric;
- expected evaluation metrics and numerical tolerance;
- hardware used for the manuscript analysis;

## Data and code availability

Processed data and trained model files are available through Zenodo:

> https://doi.org/10.5281/zenodo.21640085

The TMPNet source code is available at:

> https://github.com/Shui-Group/TMPNet

In addition, we developed a publicly accessible TMPNet database containing tissue-contextualized association predictions for 2,953 transmembrane proteins, comprising 137,510 predicted protein–protein associations, available at:

> https://shuilab.ihuman.shanghaitech.edu.cn/TMPNet

## License

TMPNet is released under the MIT License. See LICENSE for details.

## Contact

- Code and data: Shui lab, waters1215@163.com
