import os
import joblib
import pandas as pd

# ==========================================================
# 1. File paths
# ==========================================================

# Trained XGB model
model_path = (
    "XGB_1v9.joblib"
)

# Input prediction dataset

input_file = (
    "prediction_dataset.csv"
)

# Output file
output_file = (
    "result/XGB_1v9_prediction.csv"
)


# ==========================================================
# 2. Load model
# ==========================================================

model = joblib.load(
    model_path
)

print(
    "Model loaded:",
    type(model)
)

# ==========================================================
# 3. Load prediction dataset
# ==========================================================
df = pd.read_csv(
    input_file
)


# ==========================================================
# 4. Select model features
#
# Use all available features
#
# Remove annotation columns
#
# ==========================================================

remove_columns = [
    "Protein1",
    "Protein2",
    "protein1",
    "protein2",
    "pair",
    "Truth"
]

feature_cols = [
    col
    for col in df.columns
    if col not in remove_columns
]

X = df[
    feature_cols
]


# ==========================================================
# 5. Prediction
# ==========================================================

df["prediction"] = (
    model
    .predict_proba(X)[:,1]
)

# ==========================================================
# 6. Save prediction result
# ==========================================================
os.makedirs(
    os.path.dirname(output_file),
    exist_ok=True
)

df.to_csv(
    output_file,
    index=False
)