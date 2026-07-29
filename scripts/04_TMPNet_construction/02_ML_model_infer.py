import os
import joblib
import numpy as np
import pandas as pd


# ==========================================================
# 1. File paths
# ==========================================================

model_file = "XGB_1v9.joblib"
metadata_file = "XGB_1v9_metadata.joblib"

# Only contains Protein1 and Protein2
pair_file = "example/ML/input/inference_pairs.csv"

# Contains Protein1, Protein2 and all calculated features
total_features_file = "example/ML/output/total_features.csv"

output_file = "example/ML/output/XGB_1v9_prediction.csv"
unmatched_file = "example/ML/output/unmatched_pairs.csv"


# ==========================================================
# 2. Generate order-independent pair key
# ==========================================================

def add_pair_key(df):

    df = df.copy()

    df["Protein1"] = (
        df["Protein1"]
        .astype(str)
        .str.strip()
    )

    df["Protein2"] = (
        df["Protein2"]
        .astype(str)
        .str.strip()
    )

    df["pair_key"] = np.where(
        df["Protein1"] <= df["Protein2"],
        df["Protein1"] + "-" + df["Protein2"],
        df["Protein2"] + "-" + df["Protein1"]
    )

    return df


# ==========================================================
# 3. Load model and metadata
# ==========================================================

model = joblib.load(
    model_file
)

metadata = joblib.load(
    metadata_file
)

feature_cols = metadata["feature_cols"]

threshold = metadata.get(
    "classification_threshold",
    0.5
)

print("Model loaded:", type(model))
print("Number of model features:", len(feature_cols))


# ==========================================================
# 4. Load pair file
# ==========================================================

pair_df = pd.read_csv(
    pair_file
)

required_pair_columns = {
    "Protein1",
    "Protein2"
}

missing_pair_columns = (
    required_pair_columns
    - set(pair_df.columns)
)

if missing_pair_columns:

    raise ValueError(
        f"The pair file is missing columns: "
        f"{sorted(missing_pair_columns)}"
    )


# Preserve original input order
pair_df = pair_df.reset_index(
    drop=True
)

pair_df["input_order"] = np.arange(
    len(pair_df)
)

pair_df = add_pair_key(
    pair_df
)


# Preserve the original query direction
pair_df = pair_df.rename(
    columns={
        "Protein1": "QueryProtein1",
        "Protein2": "QueryProtein2"
    }
)


# ==========================================================
# 5. Load total feature table
# ==========================================================

total_features = pd.read_csv(
    total_features_file
)

required_feature_columns = {
    "Protein1",
    "Protein2"
}

missing_basic_columns = (
    required_feature_columns
    - set(total_features.columns)
)

if missing_basic_columns:

    raise ValueError(
        f"The total feature file is missing columns: "
        f"{sorted(missing_basic_columns)}"
    )


total_features = add_pair_key(
    total_features
)


# ==========================================================
# 6. Check feature columns
# ==========================================================

missing_model_features = [
    column
    for column in feature_cols
    if column not in total_features.columns
]

if missing_model_features:

    raise ValueError(
        "The following model features are missing from "
        f"total_features.csv:\n{missing_model_features}"
    )


# Check duplicated unordered pairs
duplicated_pairs = total_features[
    total_features.duplicated(
        subset="pair_key",
        keep=False
    )
]

if len(duplicated_pairs) > 0:

    os.makedirs(
        "result",
        exist_ok=True
    )

    duplicated_pairs.to_csv(
        "result/duplicated_total_feature_pairs.csv",
        index=False
    )

    raise ValueError(
        "Duplicated unordered pairs were found in total_features.csv. "
        "See result/duplicated_total_feature_pairs.csv"
    )


# Keep the orientation used for feature calculation
total_features = total_features.rename(
    columns={
        "Protein1": "FeatureProtein1",
        "Protein2": "FeatureProtein2"
    }
)


# ==========================================================
# 7. Map pair file to total_features
# ==========================================================

mapped_df = pair_df.merge(
    total_features,
    on="pair_key",
    how="left",
    validate="many_to_one",
    indicator=True
)


print("Input pairs:", len(pair_df))

print(
    "Matched pairs:",
    (mapped_df["_merge"] == "both").sum()
)

print(
    "Unmatched pairs:",
    (mapped_df["_merge"] != "both").sum()
)


# ==========================================================
# 8. Save unmatched pairs
# ==========================================================

os.makedirs(
    os.path.dirname(output_file),
    exist_ok=True
)

unmatched_df = mapped_df[
    mapped_df["_merge"] != "both"
].copy()

if len(unmatched_df) > 0:

    unmatched_df[
        [
            "QueryProtein1",
            "QueryProtein2",
            "pair_key"
        ]
    ].to_csv(
        unmatched_file,
        index=False
    )

    print(
        "Unmatched pairs saved:",
        unmatched_file
    )


# ==========================================================
# 9. Keep matched pairs
# ==========================================================

prediction_df = mapped_df[
    mapped_df["_merge"] == "both"
].copy()

prediction_df = prediction_df.sort_values(
    "input_order"
).reset_index(
    drop=True
)

if len(prediction_df) == 0:

    raise ValueError(
        "No input protein pairs were matched to total_features.csv."
    )


# ==========================================================
# 10. Prepare features
# ==========================================================

# Must use the same features and feature order as training
X = prediction_df[
    feature_cols
].copy()

X = X.apply(
    pd.to_numeric,
    errors="coerce"
)

X = X.replace(
    [np.inf, -np.inf],
    np.nan
)


print(
    "Missing feature values:",
    X.isna().sum().sum()
)


# ==========================================================
# 11. Prediction
# ==========================================================

prediction_probability = model.predict_proba(
    X
)[:, 1]

prediction_label = (
    prediction_probability >= threshold
).astype(int)

prediction_truth = np.where(
    prediction_label == 1,
    "positive",
    "negative"
)


# ==========================================================
# 12. Build output
# ==========================================================

result_df = pd.DataFrame(
    {
        "Protein1": prediction_df[
            "QueryProtein1"
        ],

        "Protein2": prediction_df[
            "QueryProtein2"
        ],

        "pairs": (
            prediction_df["QueryProtein1"]
            + "-"
            + prediction_df["QueryProtein2"]
        ),

        # Protein order used when features were calculated
        "FeatureProtein1": prediction_df[
            "FeatureProtein1"
        ],

        "FeatureProtein2": prediction_df[
            "FeatureProtein2"
        ],

        "prediction_probability": (
            prediction_probability
        ),

        "prediction_label": (
            prediction_label
        ),

        "prediction_Truth": (
            prediction_truth
        )
    }
)


# ==========================================================
# 13. Save result
# ==========================================================

result_df.to_csv(
    output_file,
    index=False
)

print("Prediction result saved:", output_file)

print("\nPrediction distribution:")

print(
    result_df["prediction_Truth"]
    .value_counts()
)
