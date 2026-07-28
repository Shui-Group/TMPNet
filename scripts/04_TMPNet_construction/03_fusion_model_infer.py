import joblib
import pandas as pd
import numpy as np

from sklearn.metrics import roc_auc_score, accuracy_score, precision_score, recall_score, f1_score

# =======================
# Load Input + Model
# =======================
df = pd.read_csv("/data02/luoht/logic_regression/20260610/external_ap_cf_data.csv")
X = df[["DL_score", "ML_score"]].values.astype(np.float32)

model = joblib.load("/data02/luoht/logic_regression/20260610/20260610_fusion_model.joblib")
scaler = joblib.load("/data02/luoht/logic_regression/20260610/20260610_fusion_model_scaler.joblib")

# =======================
# Prediction
# =======================
X_scaled = scaler.transform(X)
probs = model.predict_proba(X_scaled)[:, 1]

# =======================
# Evaluation if Truth exists
# =======================
if "Truth" in df.columns:
    truth = df["Truth"].astype(int).values

    # ===== Fixed cutoff =====
    cutoff = 0.835
    preds = (probs >= cutoff).astype(int)

    print("\n📊 Prediction Metrics (Cutoff = 0.835):")

    # AUC with safe fallback
    try:
        auc = roc_auc_score(truth, probs)
        print(f"AUC:        {auc:.4f}")
    except ValueError:
        print("AUC:        nan (not enough class variety)")

    print(f"Accuracy:   {accuracy_score(truth, preds):.4f}")
    print(f"Precision:  {precision_score(truth, preds, zero_division=0):.4f}")
    print(f"Recall:     {recall_score(truth, preds, zero_division=0):.4f}")
    print(f"F1-score:   {f1_score(truth, preds, zero_division=0):.4f}")

else:
    print("⚠️ No 'Truth' column found. Only prediction probabilities will be saved.")

# =======================
# Save Output
# =======================
df["Fusion_Pred_Prob"] = probs
df.to_csv("/data02/luoht/logic_regression/20260610/external_ap_cf_infer.csv", index=False)

