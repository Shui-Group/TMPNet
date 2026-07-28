#!/usr/bin/env bash

set -euo pipefail

###############################################################################
# SEAL-based PPI prediction pipeline
#
# Step 1. Pretraining on a generic PPI dataset
#         The input training data should be specified in:
#         DL_model_custom_dataset.py
#
# Step 2. Fine-tuning on the TMP-specific PPI dataset
#         The fine-tuning dataset should be specified in:
#         DL_model_custom_dataset.py
#
# Step 3. Inference using the fine-tuned model
#         The candidate pairs for inference should be specified in:
#         DL_model_seal_link_pred.py
###############################################################################

# -----------------------------
# Common parameters
# -----------------------------

NUM_WORKERS=32
NUM_SUBDATASETS=1
NUM_HOPS=1
EVAL_STEPS=1
RUNS=1
TRAIN_PERCENT=100

# -----------------------------
# Step 1. Pretrain on generic PPI dataset
# -----------------------------

GENERIC_DATASET="custom_ppi"
PRETRAIN_BATCH_SIZE=128
PRETRAIN_EPOCHS=150

echo "Step 1: Pretraining on generic PPI dataset..."

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

echo "Step 1 completed."


# -----------------------------
# Step 2. Fine-tune on TMP PPI dataset
# -----------------------------

TMP_DATASET="finetune_custom_ppi"
PRETRAINED_RUN_DIR="results/custom_ppi_20250710144146"
FINETUNE_BATCH_SIZE=128
FINETUNE_EPOCHS=100
FINETUNE_CONTINUE_FROM=100

echo "Step 2: Fine-tuning on TMP PPI dataset..."

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

echo "Step 2 completed."


# -----------------------------
# Step 3. Inference using fine-tuned model
# -----------------------------

FINETUNED_MODEL="results/finetune_custom_ppi_20250718104155/DL_model_finetune.pth"
INFERENCE_BATCH_SIZE=32
INFERENCE_EPOCHS=751
INFERENCE_CONTINUE_FROM=50

echo "Step 3: Running inference using the fine-tuned TMP PPI model..."

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

echo "Step 3 completed."
echo "SEAL PPI prediction pipeline finished."