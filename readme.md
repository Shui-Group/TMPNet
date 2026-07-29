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
├── environment.yml
├── DL_model_seal_link_pred.py
├── example/                                      # Example input files
├── scripts/
│   ├── 02_feature_generation/
│   │   └── proteomics_informed_model_feature_generation.py
│   ├── 03_model_training/
│   │   ├── 02_proteomics_informed_XGB.py
│   │   └── 03_Fusion_model.py
│   └── 04_TMPNet_construction/
│       ├── 02_ML_model_infer.py
│       └── 03_fusion_model_infer.py
├── results/                                      # Checkpoints and predictions
└── [TO BE PROVIDED: remaining folders in the released repository]
```

This repository provides [TO BE PROVIDED: model training, evaluation and inference code]. [TO BE PROVIDED: State whether downstream statistical analyses and manuscript figure-generation scripts are included.]

## Installation

TMPNet has been tested on Ubuntu 24.04.2 LTS with Python 3.9.21, PyTorch 2.6.0 and CUDA 12.4. The exact dependency versions are recorded in `environment.yml`.

```bash
git clone https://github.com/Shui-Group/TMPNet.git
cd TMPNet
conda env create -f environment.yml
conda activate TMPNet
```

Verify the installation:

```bash
python DL_model_seal_link_pred.py -h
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
- the generic PPI pretraining dataset;
- the TMP-specific fine-tuning dataset;
- [TO BE PROVIDED: any additional training files].

Place the downloaded files in:

```text
/example/TEMP/esm_model/
```

Precomputed ESM-2 3B embeddings are recommended because regenerating them requires substantial computational time and GPU memory.

## Usage

Example inputs are provided in `example/`. Replace all example paths with the paths to your own data.

### 1. Sequence-based model

#### Input

Example file:

```text
example/[TO BE PROVIDED: sequence-model input filename]
```

Required columns:

| Column | Description |
|---|---|
| `Interactor.A` | Protein A identifier |
| `Interactor.B` | Protein B identifier |

Example:

| Interactor.A | Interactor.B |
|---|---|
| O60906 | Q14392 |
| O60906 | P00167 |
| O60906 | Q9H8J5 |

Protein identifiers should be UniProt accession IDs.

Protein pairs are treated as unordered pairs; therefore, `(A, B)` and `(B, A)` represent the same interaction.

#### Inference

```bash
TMP_DATASET="finetune_custom_ppi"
NUM_WORKERS=32
NUM_SUBDATASETS=1
NUM_HOPS=1
EVAL_STEPS=1
RUNS=1
TRAIN_PERCENT=100

FINETUNED_MODEL="results/finetune_custom_ppi_20250718104155/DL_model_finetune.pth"
INFERENCE_BATCH_SIZE=32
INFERENCE_EPOCHS=751
INFERENCE_CONTINUE_FROM=50

python DL_model_seal_link_pred.py \
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

Output: `[TO BE PROVIDED: output path, filename and score-column definition]`.

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

python DL_model_seal_link_pred.py \
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
PRETRAINED_RUN_DIR="results/custom_ppi_20250710144146"
FINETUNE_BATCH_SIZE=128
FINETUNE_EPOCHS=100
FINETUNE_CONTINUE_FROM=100

python DL_model_seal_link_pred.py \
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
results/finetune_custom_ppi_[TIMESTAMP]/DL_model_finetune.pth
```


### 2. Proteomics-informed model

The proteomics-informed model calculates pairwise features from tissue-resolved protein-abundance profiles and applies a trained XGBoost classifier.

#### Input

Example file:

```text
example/[TO BE PROVIDED: proteomics-model input filename]
```
#### Feature generation

To generate tissue-context features from protein abundance profiles, run:

```bash
python scripts/02_feature_generation/proteomics_informed_model_feature_generation.py
```

Output: `[TO BE PROVIDED: generated feature-file path and columns]`.

#### Training

```bash
python scripts/03_model_training/02_proteomics_informed_XGB.py
```

Output: `[TO BE PROVIDED: trained XGBoost model filename]`.

#### Inference

```bash
python scripts/04_TMPNet_construction/02_ML_model_infer.py
```

Output: `[TO BE PROVIDED: proteomics-informed prediction filename and score-column definition]`.

### 3. Fusion framework

The fusion model combines the sequence-based and proteomics-informed prediction scores using logistic regression.

#### Input

Example file:

```text
example/[TO BE PROVIDED: fusion-model input filename]
```

Required columns:

| Column | Description |
|---|---|
| `DL_score` | Sequence-based prediction score |
| `ML_score` | Proteomics-informed prediction score |

The two prediction scores are merged based on the corresponding protein-pair identifier.

Protein pairs were matched using unordered protein pairs, where (A, B) and (B, A) were considered equivalent. The merge key was generated from the two protein identifiers after sorting them alphabetically. 

#### Training

```bash
python scripts/03_model_training/03_Fusion_model.py
```

Output: `[TO BE PROVIDED: trained fusion-model filename]`.

#### Inference

```bash
python scripts/04_TMPNet_construction/03_fusion_model_infer.py
```

Final output: `[TO BE PROVIDED: final TMPNet prediction filename and directory]`.

The final output contains the following columns:

| Column | Description |
|---|---|
| `DL_score` | Sequence-based prediction score |
| `ML_score` | Proteomics-informed prediction score |
| `Fusion_Pred_Prob` | Final TMPNet association probability |

A higher `Fusion_Pred_Prob` indicates a higher predicted probability of a tissue-contextual protein–protein association. The high-confidence prediction threshold is 0.84.

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
- [TO BE PROVIDED: whether all downstream analysis and figure scripts are included].

## Data and code availability

Processed data and trained model files are available through Zenodo:

> https://doi.org/10.5281/zenodo.21640085

The TMPNet source code is available at:

> https://github.com/Shui-Group/TMPNet

In addition, we developed a publicly accessible TMPNet database containing tissue-contextualized association predictions for 2,953 transmembrane proteins, comprising 137,510 predicted protein–protein associations, available at:

> https://shuilab.ihuman.shanghaitech.edu.cn/TMPNet

## License

[TO BE PROVIDED: license name]. See `LICENSE` for details.

## Contact

- Code and data: [TO BE PROVIDED: name, affiliation and email]
- Corresponding author: [TO BE PROVIDED: name, affiliation and email]
