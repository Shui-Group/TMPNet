import pandas as pd
import numpy as np
from sklearn.metrics import roc_auc_score
from joblib import Parallel, delayed
from tqdm import tqdm


# ======================
# Input and output
# ======================

input_file = "/data02/luoht/PPI_project/data/20260312_update_data/data/model_auc/20260617_test_dataset.csv"
output_file = "two_stage_degree_filter_grid_FU_fixed_DL_global.csv"
selected_output_file = "selected_parameters_precision_gt_90.csv"

df = pd.read_csv(input_file)

required_cols = [
    "pair",
    "Protein1",
    "Protein2",
    "Truth",
    "Fusion_Pred_Prob",
    "common_go_count"
]

missing_cols = [c for c in required_cols if c not in df.columns]
if missing_cols:
    raise ValueError(f"Missing required columns: {missing_cols}")


# ======================
# Data cleaning
# ======================

df = df.copy()

df["Truth"] = pd.to_numeric(df["Truth"], errors="coerce").fillna(0).astype(int)
df["Fusion_Pred_Prob"] = pd.to_numeric(df["Fusion_Pred_Prob"], errors="coerce")
df["common_go_count"] = pd.to_numeric(df["common_go_count"], errors="coerce").fillna(0)

df = df.dropna(subset=["Protein1", "Protein2", "Fusion_Pred_Prob"]).copy()

# For a PPI atlas, each pair should be unique.
# This avoids repeatedly dropping duplicated pairs inside every grid combination.
n_dup = df["pair"].duplicated().sum()
if n_dup > 0:
    print(f"Warning: {n_dup} duplicated pairs found. Keeping the first occurrence.")
    df = df.drop_duplicates(subset=["pair"], keep="first").copy()

df = df.reset_index(drop=True)


# ======================
# Fixed cutoff and parameter grids
# ======================

# Fixed global DL / Fusion cutoff
DL_global = 0.835

# Super-high-degree node ratio:
# top 10% to top 20%, step = 1%
super_hub_grid = np.round(np.arange(0.10, 0.201, 0.01), 3)

# Second-stage high-degree node ratio:
# top 20% to top 40%, step = 1%
hub_grid = np.round(np.arange(0.20, 0.401, 0.01), 3)

# Stricter cutoff for high-degree edges
DL_hub_grid = np.round(np.arange(0.900, 0.99, 0.001), 3)
DL_hub_grid = DL_hub_grid[DL_hub_grid <= 1.000]

precision_cutoff = 0.90
n_jobs = -1


# ======================
# Global statistics
# ======================

total_positive = int(df["Truth"].sum())
total_edges = len(df)

try:
    global_auc = roc_auc_score(df["Truth"], df["Fusion_Pred_Prob"])
except ValueError:
    global_auc = np.nan


# ======================
# Helper functions
# ======================

def get_degree_from_arrays(protein1, protein2):
    """
    Calculate node degree from Protein1 and Protein2 arrays.
    """
    nodes = np.concatenate([protein1, protein2])
    return pd.Series(nodes).value_counts(sort=True)


def get_hub_nodes(degree, ratio):
    """
    Select top-ratio high-degree nodes.
    """
    if len(degree) == 0:
        return set()

    n_hub = max(1, int(len(degree) * ratio))
    return set(degree.index[:n_hub])


def cumulative_keep_by_score(scores, truths, cutoffs):
    """
    For candidate edges, calculate how many edges and true positives remain
    under each score cutoff.

    Keep rule:
        score >= cutoff

    This avoids looping through every edge for every DL_hub cutoff.
    """
    scores = np.asarray(scores)
    truths = np.asarray(truths).astype(int)

    n = len(scores)

    if n == 0:
        keep_counts = np.zeros(len(cutoffs), dtype=int)
        keep_tps = np.zeros(len(cutoffs), dtype=int)
        removed_counts = np.zeros(len(cutoffs), dtype=int)
        return keep_counts, keep_tps, removed_counts

    order = np.argsort(scores)
    sorted_scores = scores[order]
    sorted_truths = truths[order]

    # cum_truth_from_i[i] = number of true positives from i to the end
    cum_truth_from_i = np.zeros(n + 1, dtype=int)
    cum_truth_from_i[:-1] = np.cumsum(sorted_truths[::-1])[::-1]

    # First index with score >= cutoff
    idx = np.searchsorted(sorted_scores, cutoffs, side="left")

    keep_counts = n - idx
    keep_tps = cum_truth_from_i[idx]
    removed_counts = idx

    return keep_counts, keep_tps, removed_counts


# ======================
# Step 1. Apply fixed DL_global cutoff once
# ======================

pred_pos = df[df["Fusion_Pred_Prob"] >= DL_global].copy().reset_index(drop=True)

if len(pred_pos) < 10:
    raise ValueError("Too few edges remain after applying DL_global cutoff.")

pred_p1 = pred_pos["Protein1"].astype(str).to_numpy()
pred_p2 = pred_pos["Protein2"].astype(str).to_numpy()
pred_score = pred_pos["Fusion_Pred_Prob"].to_numpy(dtype=float)
pred_truth = pred_pos["Truth"].to_numpy(dtype=int)
pred_go = (pred_pos["common_go_count"].to_numpy(dtype=float) >= 1)

tp_after_global = int(pred_truth.sum())
edges_after_global = len(pred_pos)

print(f"Fixed DL_global = {DL_global}")
print(f"Edges after DL_global: {edges_after_global}")
print(f"TP after DL_global: {tp_after_global}")

# First-stage degree is fixed because DL_global is fixed.
degree_stage1 = get_degree_from_arrays(pred_p1, pred_p2)


# ======================
# Grid evaluation
# ======================

def evaluate_super_hub_and_hub(super_hub_ratio, hub_ratio):
    """
    Evaluate all DL_hub cutoffs for one pair of:
        super_hub_ratio and hub_ratio

    Logic:
        1. Start from edges with Pfusion >= DL_global.
        2. Define super-high-degree nodes.
           Super-high-degree edges are retained only if GO-supported.
        3. Recalculate degree on remaining edges.
        4. Define high-degree nodes.
           High-degree edges are retained if GO-supported or Pfusion >= DL_hub.
           Non-high-degree edges are retained without further filtering.
    """

    rows = []

    # --------------------------------------------------
    # Stage 1. Super-high-degree filtering
    # --------------------------------------------------

    super_hub_nodes = get_hub_nodes(degree_stage1, super_hub_ratio)

    is_super_hub_edge = (
        np.isin(pred_p1, list(super_hub_nodes)) |
        np.isin(pred_p2, list(super_hub_nodes))
    )

    # Super-high-degree edge:
    #     keep only if GO-supported
    # Non-super-high-degree edge:
    #     keep directly
    stage1_keep = (~is_super_hub_edge) | pred_go

    if stage1_keep.sum() < 10:
        return rows

    stage1_p1 = pred_p1[stage1_keep]
    stage1_p2 = pred_p2[stage1_keep]
    stage1_score = pred_score[stage1_keep]
    stage1_truth = pred_truth[stage1_keep]
    stage1_go = pred_go[stage1_keep]

    super_hub_edges_total = int(is_super_hub_edge.sum())
    super_hub_edges_removed = int((is_super_hub_edge & (~pred_go)).sum())
    super_hub_edges_kept_by_GO = int((is_super_hub_edge & pred_go).sum())

    # --------------------------------------------------
    # Stage 2. Recalculate degree after super-hub filtering
    # --------------------------------------------------

    degree_stage2 = get_degree_from_arrays(stage1_p1, stage1_p2)
    high_degree_nodes = get_hub_nodes(degree_stage2, hub_ratio)

    is_high_degree_edge = (
        np.isin(stage1_p1, list(high_degree_nodes)) |
        np.isin(stage1_p2, list(high_degree_nodes))
    )

    # High-degree edge:
    #     keep if GO-supported or Pfusion >= DL_hub
    # Non-high-degree edge:
    #     keep directly
    always_keep = (~is_high_degree_edge) | stage1_go

    candidate_by_score = is_high_degree_edge & (~stage1_go)

    always_keep_count = int(always_keep.sum())
    always_keep_tp = int(stage1_truth[always_keep].sum())

    candidate_scores = stage1_score[candidate_by_score]
    candidate_truths = stage1_truth[candidate_by_score]

    keep_counts, keep_tps, removed_counts = cumulative_keep_by_score(
        scores=candidate_scores,
        truths=candidate_truths,
        cutoffs=DL_hub_grid
    )

    edges_left_arr = always_keep_count + keep_counts
    tp_left_arr = always_keep_tp + keep_tps
    fp_left_arr = edges_left_arr - tp_left_arr

    precision_arr = np.divide(
        tp_left_arr,
        edges_left_arr,
        out=np.full_like(tp_left_arr, np.nan, dtype=float),
        where=edges_left_arr > 0
    )

    real_recall_arr = (
        tp_left_arr / total_positive
        if total_positive > 0
        else np.full_like(tp_left_arr, np.nan, dtype=float)
    )

    recall_after_global_arr = (
        tp_left_arr / tp_after_global
        if tp_after_global > 0
        else np.full_like(tp_left_arr, np.nan, dtype=float)
    )

    high_degree_edges_total = int(is_high_degree_edge.sum())
    high_degree_edges_kept_by_GO = int((is_high_degree_edge & stage1_go).sum())
    non_high_degree_edges_kept = int((~is_high_degree_edge).sum())

    for i, DL_hub_cut in enumerate(DL_hub_grid):
        rows.append({
            "DL_global": DL_global,
            "super_hub_ratio": super_hub_ratio,
            "hub_ratio": hub_ratio,
            "DL_hub": float(DL_hub_cut),

            "precision": float(precision_arr[i]),
            "real_recall": float(real_recall_arr[i]),
            "recall_after_global": float(recall_after_global_arr[i]),
            "AUC": global_auc,

            "total_edges": total_edges,
            "edges_after_DL_global": edges_after_global,
            "edges_after_super_hub_filter": int(stage1_keep.sum()),
            "edges_left": int(edges_left_arr[i]),

            "TP_after_DL_global": tp_after_global,
            "TP_left": int(tp_left_arr[i]),
            "FP_left": int(fp_left_arr[i]),

            "n_super_hub_nodes": len(super_hub_nodes),
            "super_hub_edges_total": super_hub_edges_total,
            "super_hub_edges_removed": super_hub_edges_removed,
            "super_hub_edges_kept_by_GO": super_hub_edges_kept_by_GO,

            "n_high_degree_nodes": len(high_degree_nodes),
            "high_degree_edges_total": high_degree_edges_total,
            "high_degree_edges_removed": int(removed_counts[i]),
            "high_degree_edges_kept_by_GO": high_degree_edges_kept_by_GO,
            "high_degree_edges_kept_by_score": int(keep_counts[i]),
            "non_high_degree_edges_kept": non_high_degree_edges_kept
        })

    return rows


# ======================
# Run 3-parameter grid search
# ======================

tasks = [
    (super_hub_ratio, hub_ratio)
    for super_hub_ratio in super_hub_grid
    for hub_ratio in hub_grid
]

nested_results = Parallel(n_jobs=n_jobs, prefer="threads")(
    delayed(evaluate_super_hub_and_hub)(super_hub_ratio, hub_ratio)
    for super_hub_ratio, hub_ratio in tqdm(tasks, desc="super_hub_ratio × hub_ratio")
)

results = [row for sublist in nested_results for row in sublist]


# ======================
# Save all grid-search results
# ======================

res_df = pd.DataFrame(results)

# Save all results, sorted by precision first for inspection
res_df_sorted = res_df.sort_values(
    by=["precision", "real_recall", "edges_left"],
    ascending=[False, False, False]
)

res_df_sorted.to_csv(output_file, index=False)

print(f"Saved grid-search results to: {output_file}")
print(res_df_sorted.head(20))


# ======================
# Select final parameters
# ======================

candidate_df = res_df[res_df["precision"] > precision_cutoff].copy()

if len(candidate_df) == 0:
    print(f"No parameter set reached precision > {precision_cutoff}.")
else:
    # Match the Methods:
    # retain the maximum number of predictions while maintaining precision > 90%
    best_df = candidate_df.sort_values(
        by=["edges_left", "precision", "real_recall"],
        ascending=[False, False, False]
    ).head(1)

    best_df.to_csv(selected_output_file, index=False)

    print(f"Saved selected parameters to: {selected_output_file}")
    print("Selected parameter set:")
    print(best_df)