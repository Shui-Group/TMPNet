# ==========================================================
# 1. Load packages
# ==========================================================

import os
import joblib
import numpy as np
import pandas as pd


# ==========================================================
# 2. File paths
# ==========================================================

# Trained XGBoost model
MODEL_FILE = "XGB_1v9.joblib"

# Metadata saved during model training
# Contains feature_cols and classification_threshold
METADATA_FILE = "XGB_1v9_metadata.joblib"

# Inference protein pairs:
# Protein1, Protein2
PAIR_FILE = "inference_pairs.csv"

# Features calculated for inference protein pairs:
# Protein1, Protein2, and the 17 feature columns
FEATURE_FILE = "inference_features.csv"

# Prediction result
OUTPUT_FILE = "result/XGB_1v9_prediction.csv"

# Pairs without corresponding features
UNMATCHED_OUTPUT_FILE = "result/XGB_1v9_unmatched_pairs.csv"


# ==========================================================
# 3. Generate order-independent pair key
#
# A-B and B-A are treated as the same pair.
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
# 4. Load model
# ==========================================================

model = joblib.load(
    MODEL_FILE
)

print(
    "Model loaded:",
    type(model)
)


# ==========================================================
# 5. Load expected feature names
# ==========================================================

if os.path.exists(METADATA_FILE):

    metadata = joblib.load(
        METADATA_FILE
    )

    feature_cols = metadata[
        "feature_cols"
    ]

    classification_threshold = metadata.get(
        "classification_threshold",
        0.5
    )

    print(
        "Feature names loaded from:",
        METADATA_FILE
    )

else:

    # Fallback: try to read feature names from XGBoost
    feature_cols = model.get_booster().feature_names

    classification_threshold = 0.5

    if feature_cols is None:

        raise ValueError(
            "Feature names could not be obtained. "
            "Please provide XGB_1v9_metadata.joblib."
        )

    print(
        "Warning: metadata file was not found. "
        "Feature names were read from the XGBoost model."
    )


print(
    "Number of expected features:",
    len(feature_cols)
)

print(
    "Expected features:",
    feature_cols
)


# ==========================================================
# 6. Load inference protein-pair table
# ==========================================================

pair_df = pd.read_csv(
    PAIR_FILE
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
        f"{PAIR_FILE} is missing columns: "
        f"{sorted(missing_pair_columns)}"
    )


# Keep the original input order
pair_df = pair_df.reset_index(
    drop=True
)

pair_df["input_row"] = np.arange(
    len(pair_df)
)


pair_df = add_pair_key(
    pair_df
)


# Rename input proteins so that they are not overwritten
# by Protein1/Protein2 from the feature table.
pair_df = pair_df.rename(
    columns={
        "Protein1": "QueryProtein1",
        "Protein2": "QueryProtein2"
    }
)


print(
    "Number of input protein pairs:",
    len(pair_df)
)


# ==========================================================
# 7. Load inference features
# ==========================================================

feature_df = pd.read_csv(
    FEATURE_FILE
)


required_feature_columns = {
    "Protein1",
    "Protein2"
}

missing_basic_feature_columns = (
    required_feature_columns
    - set(feature_df.columns)
)

if missing_basic_feature_columns:

    raise ValueError(
        f"{FEATURE_FILE} is missing columns: "
        f"{sorted(missing_basic_feature_columns)}"
    )


feature_df = add_pair_key(
    feature_df
)


# Check whether one unordered pair appears multiple times
duplicated_feature_pairs = feature_df[
    feature_df.duplicated(
        subset="pair_key",
        keep=False
    )
]

if len(duplicated_feature_pairs) > 0:

    os.makedirs(
        os.path.dirname(UNMATCHED_OUTPUT_FILE),
        exist_ok=True
    )

    duplicated_feature_pairs.to_csv(
        "result/duplicated_inference_feature_pairs.csv",
        index=False
    )

    raise ValueError(
        "Duplicated unordered protein pairs were found "
        "in the inference feature table. See "
        "result/duplicated_inference_feature_pairs.csv"
    )


# Confirm that all model features exist
missing_model_features = [
    feature
    for feature in feature_cols
    if feature not in feature_df.columns
]

if missing_model_features:

    raise ValueError(
        "The inference feature table is missing model features:\n"
        f"{missing_model_features}"
    )


# Rename feature-table protein IDs
feature_df = feature_df.rename(
    columns={
        "Protein1": "FeatureProtein1",
        "Protein2": "FeatureProtein2"
    }
)


# ==========================================================
# 8. Merge inference pairs with calculated features
# ==========================================================

merged_df = pair_df.merge(
    feature_df,
    on="pair_key",
    how="left",
    validate="many_to_one",
    indicator=True
)


# ==========================================================
# 9. Save unmatched pairs
# ==========================================================

unmatched_df = merged_df[
    merged_df["_merge"] != "both"
].copy()


os.makedirs(
    os.path.dirname(OUTPUT_FILE),
    exist_ok=True
)


if len(unmatched_df) > 0:

    unmatched_df[
        [
            "input_row",
            "QueryProtein1",
            "QueryProtein2",
            "pair_key"
        ]
    ].to_csv(
        UNMATCHED_OUTPUT_FILE,
        index=False
    )

    print(
        f"Warning: {len(unmatched_df)} protein pairs "
        "do not have calculated features."
    )

    print(
        "Unmatched pairs saved:",
        UNMATCHED_OUTPUT_FILE
    )


# Keep successfully matched pairs
prediction_df = merged_df[
    merged_df["_merge"] == "both"
].copy()


prediction_df = prediction_df.sort_values(
    "input_row"
).reset_index(
    drop=True
)


if len(prediction_df) == 0:

    raise ValueError(
        "None of the inference protein pairs matched "
        "the feature table."
    )


print(
    "Number of matched protein pairs:",
    len(prediction_df)
)


# ==========================================================
# 10. Prepare model input
#
# Feature order must be exactly the same as during training.
# ==========================================================

X = prediction_df[
    feature_cols
].copy()


# Convert all feature columns to numeric values
X = X.apply(
    pd.to_numeric,
    errors="coerce"
)


# XGBoost supports NaN but does not accept infinity
X = X.replace(
    [np.inf, -np.inf],
    np.nan
)


missing_value_number = X.isna().sum().sum()

print(
    "Number of missing feature values:",
    missing_value_number
)


# Check rows for which every feature is missing
all_missing_rows = X.isna().all(
    axis=1
)

if all_missing_rows.any():

    all_missing_output = prediction_df.loc[
        all_missing_rows,
        [
            "QueryProtein1",
            "QueryProtein2",
            "pair_key"
        ]
    ]

    all_missing_output.to_csv(
        "result/all_features_missing_pairs.csv",
        index=False
    )

    raise ValueError(
        f"{all_missing_rows.sum()} protein pairs have "
        "no valid feature values. See "
        "result/all_features_missing_pairs.csv"
    )


# ==========================================================
# 11. Prediction
# ==========================================================

prediction_probability = model.predict_proba(
    X
)[:, 1]


prediction_label = (
    prediction_probability
    >= classification_threshold
).astype(int)


prediction_truth = np.where(
    prediction_label == 1,
    "positive",
    "negative"
)


# ==========================================================
# 12. Build output table
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

        # The orientation used when calculating the features
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
# 13. Save prediction result
# ==========================================================

result_df.to_csv(
    OUTPUT_FILE,
    index=False
)


print(
    "Prediction result saved:",
    OUTPUT_FILE
)

print(
    "Classification threshold:",
    classification_threshold
)

print(
    "Prediction distribution:"
)

print(
    result_df[
        "prediction_Truth"
    ].value_counts()
)
