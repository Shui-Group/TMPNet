import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    f1_score, accuracy_score, recall_score, precision_score,
    roc_auc_score, roc_curve, confusion_matrix
)
from sklearn.model_selection import train_test_split

import joblib
import os
import json

np.random.seed(99)

# ================================
# 输出目录
# ================================
output_dir = "/data02/luoht/logic_regression/20260610"
os.makedirs(output_dir, exist_ok=True)
print(f"All outputs will be saved to: {output_dir}")

# ================================
# 输入文件
# ================================
file = "/data02/luoht/logic_regression/20260610/fusion_model_training_dataset.csv"
label = "20260610_fusion"

# ================================
# 读取数据
# ================================
df = pd.read_csv(file)
df["Truth"] = df["Truth"].astype(int)

print(df.head())

# ================================
# train/val 分割（保持正负比例）
# ================================
df_train, df_val = train_test_split(
    df,
    test_size=0.2,
    stratify=df["Truth"],
    random_state=42
)

# 保存验证集 meta 信息
val_meta = df_val[[
    "pair",
    "Protein1",
    "Protein2",
    "DL_score",
    "ML_score",
    "raw_overlap_count"
]].reset_index(drop=True)

# ================================
# 训练集 1:9 采样
# ================================
positives = df_train[df_train["Truth"] == 1]
negatives = df_train[df_train["Truth"] == 0]

n_pos = len(positives)
n_neg_needed = n_pos * 9

if len(negatives) < n_neg_needed:
    print(f"⚠️ 负样本不足，将使用全部负样本 {len(negatives)}")
    negatives_sampled = negatives
else:
    negatives_sampled = negatives.sample(n=n_neg_needed, random_state=42)

train_df = pd.concat([positives, negatives_sampled], axis=0)
train_df = train_df.sample(frac=1, random_state=42).reset_index(drop=True)

print(f"Train size: {len(train_df)} (pos={len(positives)}, neg={len(negatives_sampled)})")
print(f"Val size:   {len(df_val)}")

# ================================
# 提取 X, y
# ================================
feature_names = ["DL_score", "ML_score"]

X_train_raw = train_df[feature_names].values.astype(np.float32)
y_train = train_df["Truth"].values

X_val_raw = df_val[feature_names].values.astype(np.float32)
y_val = df_val["Truth"].values

# ================================
# 标准化
# ================================
scaler = StandardScaler()
X_train = scaler.fit_transform(X_train_raw)
X_val = scaler.transform(X_val_raw)

# ================================
# 训练模型
# ================================
model = LogisticRegression(
    class_weight="balanced",
    max_iter=1000,
    random_state=42
)
model.fit(X_train, y_train)

# ================================
# 保存模型和 scaler
# ================================
model_path = os.path.join(output_dir, f"{label}_model.joblib")
scaler_path = os.path.join(output_dir, f"{label}_scaler.joblib")

joblib.dump(model, model_path)
joblib.dump(scaler, scaler_path)

print(f"\nModel saved to: {model_path}")
print(f"Scaler saved to: {scaler_path}")

# ================================
# 提取并保存模型权重
# ================================

# 标准化特征空间下的系数
coef_standardized = model.coef_[0]
intercept_standardized = model.intercept_[0]

# 还原到原始 DL_score / ML_score 空间
#
# 标准化公式：
#   x_scaled = (x_raw - mean) / scale
#
# 模型公式：
#   logit(p) = coef_standardized * x_scaled + intercept_standardized
#
# 展开后：
#   logit(p) = coef_raw * x_raw + intercept_raw
#
coef_raw = coef_standardized / scaler.scale_
intercept_raw = intercept_standardized - np.sum(
    coef_standardized * scaler.mean_ / scaler.scale_
)

# 根据标准化系数的绝对值计算相对权重
abs_weights = np.abs(coef_standardized)

if abs_weights.sum() == 0:
    relative_weights = np.zeros_like(abs_weights)
else:
    relative_weights = abs_weights / abs_weights.sum()

print("\n===== Logistic Regression Weights =====")

print("\n[1] Weights in standardized feature space")
for name, coef in zip(feature_names, coef_standardized):
    print(f"{name}: {coef:.6f}")
print(f"Intercept: {intercept_standardized:.6f}")

print("\nStandardized model formula:")
print(
    f"logit(p) = "
    f"({coef_standardized[0]:.6f}) * DL_score_z + "
    f"({coef_standardized[1]:.6f}) * ML_score_z + "
    f"({intercept_standardized:.6f})"
)

print("\n[2] Weights in raw feature space")
for name, coef in zip(feature_names, coef_raw):
    print(f"{name}: {coef:.6f}")
print(f"Intercept: {intercept_raw:.6f}")

print("\nRaw score model formula:")
print(
    f"logit(p) = "
    f"({coef_raw[0]:.6f}) * DL_score + "
    f"({coef_raw[1]:.6f}) * ML_score + "
    f"({intercept_raw:.6f})"
)

print("\n[3] Relative weights based on standardized coefficients")
for name, weight in zip(feature_names, relative_weights):
    print(f"{name}: {weight:.4f}")

weights_dict = {
    "feature_names": feature_names,

    "coef_standardized": {
        feature_names[i]: float(coef_standardized[i])
        for i in range(len(feature_names))
    },
    "intercept_standardized": float(intercept_standardized),

    "coef_raw": {
        feature_names[i]: float(coef_raw[i])
        for i in range(len(feature_names))
    },
    "intercept_raw": float(intercept_raw),

    "relative_weight_abs_standardized": {
        feature_names[i]: float(relative_weights[i])
        for i in range(len(feature_names))
    },

    "scaler_mean": {
        feature_names[i]: float(scaler.mean_[i])
        for i in range(len(feature_names))
    },
    "scaler_scale": {
        feature_names[i]: float(scaler.scale_[i])
        for i in range(len(feature_names))
    },

    "formula_standardized": (
        f"logit(p) = "
        f"({coef_standardized[0]:.10f}) * DL_score_z + "
        f"({coef_standardized[1]:.10f}) * ML_score_z + "
        f"({intercept_standardized:.10f})"
    ),

    "formula_raw": (
        f"logit(p) = "
        f"({coef_raw[0]:.10f}) * DL_score + "
        f"({coef_raw[1]:.10f}) * ML_score + "
        f"({intercept_raw:.10f})"
    )
}

weights_path = os.path.join(output_dir, f"{label}_model_weights.json")

with open(weights_path, "w") as f:
    json.dump(weights_dict, f, indent=4)

print(f"\nModel weights saved to: {weights_path}")

# ================================
# 验证集预测
# ================================
val_probs = model.predict_proba(X_val)[:, 1]

# ================================
# 自动寻找最佳阈值：F1 最大
# ================================
thresholds = np.linspace(0, 1, 501)

f1_scores = [
    f1_score(y_val, (val_probs >= t).astype(int), zero_division=0)
    for t in thresholds
]

best_idx = np.argmax(f1_scores)
best_thresh = thresholds[best_idx]
best_f1 = f1_scores[best_idx]

# 最优预测标签
y_pred = (val_probs >= best_thresh).astype(int)

# ================================
# 指标计算
# ================================
acc = accuracy_score(y_val, y_pred)
recall = recall_score(y_val, y_pred, zero_division=0)
precision = precision_score(y_val, y_pred, zero_division=0)
auc = roc_auc_score(y_val, val_probs)

cm = confusion_matrix(y_val, y_pred)

metrics_dict = {
    "best_threshold": float(best_thresh),
    "F1": float(best_f1),
    "Accuracy": float(acc),
    "Recall": float(recall),
    "Precision": float(precision),
    "AUC": float(auc),
    "ConfusionMatrix": cm.tolist()
}

# 保存指标
metrics_path = os.path.join(output_dir, f"{label}_metrics.json")

with open(metrics_path, "w") as f:
    json.dump(metrics_dict, f, indent=4)

print("\n===== Evaluation Metrics =====")
for k, v in metrics_dict.items():
    print(k, ":", v)

print(f"\nMetrics saved to: {metrics_path}")

# ================================
# 保存预测结果 CSV
# ================================
out_df = val_meta.copy()
out_df["Label"] = y_val
out_df["Prediction"] = val_probs
out_df["Pred_Label"] = y_pred

val_result_path = os.path.join(
    output_dir,
    f"{label}_val_results_thr{best_thresh:.3f}.csv"
)

out_df.to_csv(val_result_path, index=False)

print(f"Validation results saved to: {val_result_path}")

# ================================
# 保存 ROC 曲线数据
# ================================
fpr, tpr, roc_thr = roc_curve(y_val, val_probs)

roc_curve_path = os.path.join(output_dir, f"{label}_roc_curve.csv")

pd.DataFrame({
    "FPR": fpr,
    "TPR": tpr,
    "Threshold": roc_thr
}).to_csv(roc_curve_path, index=False)

print(f"ROC curve data saved to: {roc_curve_path}")

# ================================
# 绘图
# ================================
fig, axes = plt.subplots(1, 2, figsize=(14, 6))

# F1 vs threshold
axes[0].plot(thresholds, f1_scores)
axes[0].axvline(best_thresh, linestyle="--")
axes[0].set_title("F1-score vs Threshold")
axes[0].set_xlabel("Threshold")
axes[0].set_ylabel("F1-score")
axes[0].grid(True)

# ROC
axes[1].plot(fpr, tpr, label=f"AUC={auc:.3f}")
axes[1].plot([0, 1], [0, 1], "k--")
axes[1].set_title("ROC Curve")
axes[1].set_xlabel("False Positive Rate")
axes[1].set_ylabel("True Positive Rate")
axes[1].legend()
axes[1].grid(True)

plt.tight_layout()

plot_path = os.path.join(output_dir, f"{label}_plots.png")
plt.savefig(plot_path, dpi=300)
plt.close()

print(f"Plots saved to: {plot_path}")

# ================================
# 保存验证集预测时使用的标准化输入
# 可选，方便后续检查
# ================================
val_scaled_df = val_meta.copy()
val_scaled_df["DL_score_scaled"] = X_val[:, 0]
val_scaled_df["ML_score_scaled"] = X_val[:, 1]
val_scaled_df["Label"] = y_val
val_scaled_df["Prediction"] = val_probs
val_scaled_df["Pred_Label"] = y_pred

val_scaled_path = os.path.join(output_dir, f"{label}_val_scaled_features.csv")
val_scaled_df.to_csv(val_scaled_path, index=False)

print(f"Scaled validation features saved to: {val_scaled_path}")

print("\n✔ All outputs saved successfully.")