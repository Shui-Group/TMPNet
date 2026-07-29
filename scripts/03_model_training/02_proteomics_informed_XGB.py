# ==========================================================
# 1. Load packages
# ==========================================================

import json
import joblib
import optuna
import numpy as np
import pandas as pd

from xgboost import XGBClassifier

from sklearn.model_selection import (
    StratifiedKFold,
    cross_val_predict
)

from sklearn.metrics import (
    roc_auc_score,
    accuracy_score,
    precision_score,
    recall_score,
    f1_score
)


# ==========================================================
# 2. File paths and general settings
# ==========================================================

# Training PPI labels:
# Truth, pairs, Protein1, Protein2
TRAIN_LABEL_FILE = "training_label.csv"

# Testing PPI labels:
# Truth, pairs, Protein1, Protein2
TEST_LABEL_FILE = "testing_label.csv"

# Feature table:
# Protein1, Protein2, and feature columns
FEATURE_FILE = "final_features.csv"


# Output merged datasets
TRAINING_SET_OUTPUT = "training_set.csv"
TESTING_SET_OUTPUT = "testing_set.csv"

# Output unmatched pairs
TRAINING_UNMATCHED_OUTPUT = "training_unmatched_pairs.csv"
TESTING_UNMATCHED_OUTPUT = "testing_unmatched_pairs.csv"

# Model output
MODEL_OUTPUT = "XGB_1v9.joblib"
METADATA_OUTPUT = "XGB_1v9_metadata.joblib"

RANDOM_STATE = 123


# ==========================================================
# 3. Generate an order-independent protein-pair key
#
# A-B and B-A are treated as the same protein pair.
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
# 4. Read and validate label data
# ==========================================================

def read_label_file(label_file):

    labels = pd.read_csv(label_file)

    required_columns = {
        "Truth",
        "Protein1",
        "Protein2"
    }

    missing_columns = (
        required_columns
        - set(labels.columns)
    )

    if missing_columns:

        raise ValueError(
            f"{label_file} is missing columns: "
            f"{sorted(missing_columns)}"
        )

    labels["Truth"] = (
        labels["Truth"]
        .astype(str)
        .str.strip()
        .str.lower()
    )

    valid_labels = {
        "positive",
        "negative"
    }

    invalid_labels = set(
        labels["Truth"].unique()
    ) - valid_labels

    if invalid_labels:

        raise ValueError(
            f"Invalid Truth values in {label_file}: "
            f"{sorted(invalid_labels)}"
        )

    labels = add_pair_key(labels)

    # Check whether the same pair has conflicting labels
    truth_number_per_pair = (
        labels
        .groupby("pair_key")["Truth"]
        .nunique()
    )

    conflicting_pairs = truth_number_per_pair[
        truth_number_per_pair > 1
    ]

    if len(conflicting_pairs) > 0:

        conflict_table = labels[
            labels["pair_key"].isin(
                conflicting_pairs.index
            )
        ]

        conflict_output = (
            label_file
            .replace(".csv", "_conflicting_labels.csv")
        )

        conflict_table.to_csv(
            conflict_output,
            index=False
        )

        raise ValueError(
            f"{len(conflicting_pairs)} pairs have conflicting "
            f"positive/negative labels. See {conflict_output}"
        )

    # Remove repeated rows of the same protein pair
    duplicated_number = labels.duplicated(
        subset="pair_key"
    ).sum()

    if duplicated_number > 0:

        print(
            f"Warning: {duplicated_number} duplicated pairs "
            f"were removed from {label_file}."
        )

        labels = labels.drop_duplicates(
            subset="pair_key",
            keep="first"
        )

    return labels


# ==========================================================
# 5. Read and validate feature data
# ==========================================================

def read_feature_file(feature_file):

    features = pd.read_csv(feature_file)

    required_columns = {
        "Protein1",
        "Protein2"
    }

    missing_columns = (
        required_columns
        - set(features.columns)
    )

    if missing_columns:

        raise ValueError(
            f"{feature_file} is missing columns: "
            f"{sorted(missing_columns)}"
        )

    features = add_pair_key(features)

    # A pair should have only one feature row
    duplicated_features = features[
        features.duplicated(
            subset="pair_key",
            keep=False
        )
    ]

    if len(duplicated_features) > 0:

        duplicated_features.to_csv(
            "duplicated_feature_pairs.csv",
            index=False
        )

        raise ValueError(
            "The feature file contains duplicated unordered "
            "protein pairs. See duplicated_feature_pairs.csv"
        )

    return features


# ==========================================================
# 6. Merge labels with features
# ==========================================================

def merge_labels_and_features(
    labels,
    features,
    output_file,
    unmatched_output_file
):

    # Preserve label-table protein IDs for unmatched-pair checking.
    # Protein1 and Protein2 in the final table are taken from
    # the feature table, so their order matches the calculated
    # prot1/prot2 feature orientation.

    label_for_merge = labels[
        [
            "pair_key",
            "Truth",
            "Protein1",
            "Protein2"
        ]
    ].rename(
        columns={
            "Protein1": "LabelProtein1",
            "Protein2": "LabelProtein2"
        }
    )

    merged = label_for_merge.merge(
        features,
        on="pair_key",
        how="left",
        validate="one_to_one",
        indicator=True
    )

    # Save label pairs without calculated features
    unmatched = merged[
        merged["_merge"] != "both"
    ].copy()

    if len(unmatched) > 0:

        unmatched[
            [
                "Truth",
                "pair_key",
                "LabelProtein1",
                "LabelProtein2"
            ]
        ].to_csv(
            unmatched_output_file,
            index=False
        )

        print(
            f"Warning: {len(unmatched)} pairs do not have "
            f"corresponding features."
        )

        print(
            f"Unmatched pairs saved to: "
            f"{unmatched_output_file}"
        )

    # Keep successfully matched rows
    merged = merged[
        merged["_merge"] == "both"
    ].copy()

    merged = merged.drop(
        columns=[
            "_merge",
            "pair_key",
            "LabelProtein1",
            "LabelProtein2"
        ]
    )

    # Rebuild pairs according to the feature-table orientation
    merged["pairs"] = (
        merged["Protein1"].astype(str)
        + "-"
        + merged["Protein2"].astype(str)
    )

    non_feature_columns = {
        "Truth",
        "pairs",
        "pair",
        "Protein1",
        "Protein2",
        "label",
        "pair_key"
    }

    feature_columns = [
        column
        for column in merged.columns
        if column not in non_feature_columns
    ]

    # Put metadata first and Truth last
    merged = merged[
        [
            "pairs",
            "Protein1",
            "Protein2"
        ]
        + feature_columns
        + [
            "Truth"
        ]
    ]

    merged.to_csv(
        output_file,
        index=False
    )

    print("\nMerged dataset saved:", output_file)
    print("Number of rows:", len(merged))
    print("Number of features:", len(feature_columns))

    print("Truth distribution:")
    print(
        merged["Truth"].value_counts()
    )

    return merged


# ==========================================================
# 7. Load and merge training/testing data
# ==========================================================

train_labels = read_label_file(
    TRAIN_LABEL_FILE
)

test_labels = read_label_file(
    TEST_LABEL_FILE
)

feature_df = read_feature_file(
    FEATURE_FILE
)


train_df = merge_labels_and_features(
    labels=train_labels,
    features=feature_df,
    output_file=TRAINING_SET_OUTPUT,
    unmatched_output_file=TRAINING_UNMATCHED_OUTPUT
)


test_df = merge_labels_and_features(
    labels=test_labels,
    features=feature_df,
    output_file=TESTING_SET_OUTPUT,
    unmatched_output_file=TESTING_UNMATCHED_OUTPUT
)


# ==========================================================
# 8. Check training/testing pair overlap
# ==========================================================

train_pairs = set(
    train_df["pairs"]
)

test_pairs = set(
    test_df["pairs"]
)

overlapping_pairs = (
    train_pairs
    & test_pairs
)

if len(overlapping_pairs) > 0:

    print(
        f"\nWarning: {len(overlapping_pairs)} protein pairs "
        "occur in both training and testing datasets."
    )

    pd.DataFrame(
        {
            "pairs": sorted(overlapping_pairs)
        }
    ).to_csv(
        "training_testing_overlapping_pairs.csv",
        index=False
    )


# ==========================================================
# 9. Automatically define feature columns
# ==========================================================

remove_columns = {
    "Protein1",
    "Protein2",
    "Truth",
    "pairs",
    "pair",
    "label",
    "pair_key"
}

feature_cols = [
    column
    for column in train_df.columns
    if column not in remove_columns
]


# Confirm that testing data contain the same features
missing_test_features = [
    column
    for column in feature_cols
    if column not in test_df.columns
]

if missing_test_features:

    raise ValueError(
        "The following training features are missing "
        f"from the testing data: {missing_test_features}"
    )


extra_test_features = [
    column
    for column in test_df.columns
    if (
        column not in feature_cols
        and column not in remove_columns
    )
]

if extra_test_features:

    print(
        "Warning: testing data contain additional features "
        "that will not be used:"
    )

    print(extra_test_features)


# Convert feature columns to numeric
for column in feature_cols:

    train_df[column] = pd.to_numeric(
        train_df[column],
        errors="coerce"
    )

    test_df[column] = pd.to_numeric(
        test_df[column],
        errors="coerce"
    )


# Replace positive/negative infinity with missing values
train_df[feature_cols] = train_df[
    feature_cols
].replace(
    [np.inf, -np.inf],
    np.nan
)

test_df[feature_cols] = test_df[
    feature_cols
].replace(
    [np.inf, -np.inf],
    np.nan
)


print("\nFeature columns:")
print(feature_cols)

print(
    "\nNumber of missing values in the full training data:",
    train_df[feature_cols].isna().sum().sum()
)

print(
    "Number of missing values in the testing data:",
    test_df[feature_cols].isna().sum().sum()
)


# ==========================================================
# 10. Define fixed label mapping
#
# Do not independently fit LabelEncoder on train and test.
# ==========================================================

label_mapping = {
    "negative": 0,
    "positive": 1
}

y_test = (
    test_df["Truth"]
    .map(label_mapping)
    .astype(int)
)

X_test = test_df[
    feature_cols
].copy()


# ==========================================================
# 11. Generate 1:9 training dataset
#
# Positive : Negative = 1 : 9
# ==========================================================

positive_train = train_df[
    train_df["Truth"] == "positive"
].copy()

negative_train = train_df[
    train_df["Truth"] == "negative"
].copy()


required_negative_number = (
    len(positive_train) * 9
)

if len(negative_train) < required_negative_number:

    raise ValueError(
        "There are not enough negative training samples.\n"
        f"Positive samples: {len(positive_train)}\n"
        f"Required negative samples: {required_negative_number}\n"
        f"Available negative samples: {len(negative_train)}"
    )


negative_sample = negative_train.sample(
    n=required_negative_number,
    replace=False,
    random_state=RANDOM_STATE
)


train_df_1v9 = pd.concat(
    [
        positive_train,
        negative_sample
    ],
    ignore_index=True
).sample(
    frac=1,
    random_state=RANDOM_STATE
).reset_index(
    drop=True
)


X_train = train_df_1v9[
    feature_cols
].copy()

y_train = (
    train_df_1v9["Truth"]
    .map(label_mapping)
    .astype(int)
)


print("\nFinal 1:9 training dataset:")
print("Shape:", train_df_1v9.shape)

print("Label distribution:")
print(
    train_df_1v9["Truth"].value_counts()
)


# Save the exact 1:9 dataset used for model training
train_df_1v9.to_csv(
    "training_set_1v9_used.csv",
    index=False
)


# ==========================================================
# 12. Optuna objective
# ==========================================================

def objective(trial):

    params = {

        "n_estimators": trial.suggest_int(
            "n_estimators",
            100,
            500
        ),

        "max_depth": trial.suggest_int(
            "max_depth",
            3,
            10
        ),

        "learning_rate": trial.suggest_float(
            "learning_rate",
            0.01,
            0.3,
            log=True
        ),

        "subsample": trial.suggest_float(
            "subsample",
            0.5,
            1.0
        ),

        "colsample_bytree": trial.suggest_float(
            "colsample_bytree",
            0.5,
            1.0
        ),

        "objective": "binary:logistic",

        "tree_method": "hist",

        "eval_metric": "logloss",

        "random_state": RANDOM_STATE,

        "n_jobs": 25
    }


    model = XGBClassifier(
        **params
    )


    cv = StratifiedKFold(
        n_splits=5,
        shuffle=True,
        random_state=RANDOM_STATE
    )


    y_probability = cross_val_predict(
        estimator=model,
        X=X_train,
        y=y_train,
        cv=cv,
        method="predict_proba",

        # Each XGBoost model already uses 25 CPU threads.
        # Do not run multiple folds in parallel here.
        n_jobs=1
    )[:, 1]


    auc = roc_auc_score(
        y_train,
        y_probability
    )

    return auc


# ==========================================================
# 13. Run Optuna
# ==========================================================

sampler = optuna.samplers.TPESampler(
    seed=RANDOM_STATE
)

study = optuna.create_study(
    direction="maximize",
    sampler=sampler
)

study.optimize(
    objective,
    n_trials=30
)


best_params = study.best_params


print("\nBest cross-validation AUROC:")
print(study.best_value)

print("\nBest parameters:")
print(best_params)


# Save all Optuna trials
study.trials_dataframe().to_csv(
    "XGB_1v9_optuna_trials.csv",
    index=False
)


with open(
    "XGB_1v9_best_params.json",
    "w",
    encoding="utf-8"
) as file:

    json.dump(
        best_params,
        file,
        indent=4
    )


# ==========================================================
# 14. Train final XGBoost model
# ==========================================================

final_model = XGBClassifier(

    **best_params,

    objective="binary:logistic",

    tree_method="hist",

    eval_metric="logloss",

    random_state=RANDOM_STATE,

    n_jobs=25
)


final_model.fit(
    X_train,
    y_train
)


# ==========================================================
# 15. Evaluate model on testing dataset
# ==========================================================

test_probability = final_model.predict_proba(
    X_test
)[:, 1]


test_prediction = (
    test_probability >= 0.5
).astype(int)


test_auc = roc_auc_score(
    y_test,
    test_probability
)

test_accuracy = accuracy_score(
    y_test,
    test_prediction
)

test_precision = precision_score(
    y_test,
    test_prediction,
    zero_division=0
)

test_recall = recall_score(
    y_test,
    test_prediction,
    zero_division=0
)

test_f1 = f1_score(
    y_test,
    test_prediction,
    zero_division=0
)


test_metrics = pd.DataFrame(
    {
        "AUROC": [test_auc],
        "Accuracy": [test_accuracy],
        "Precision": [test_precision],
        "Recall": [test_recall],
        "F1": [test_f1],
        "Threshold": [0.5],
        "Training_positive": [
            int((y_train == 1).sum())
        ],
        "Training_negative": [
            int((y_train == 0).sum())
        ],
        "Testing_positive": [
            int((y_test == 1).sum())
        ],
        "Testing_negative": [
            int((y_test == 0).sum())
        ]
    }
)


test_metrics.to_csv(
    "XGB_1v9_test_metrics.csv",
    index=False
)


print("\nTesting performance:")
print(test_metrics.to_string(index=False))


# Save testing predictions
test_prediction_output = test_df[
    [
        "pairs",
        "Protein1",
        "Protein2",
        "Truth"
    ]
].copy()


test_prediction_output["True_label"] = (
    y_test.values
)

test_prediction_output["Prediction_probability"] = (
    test_probability
)

test_prediction_output["Predicted_label"] = (
    test_prediction
)

test_prediction_output["Predicted_Truth"] = np.where(
    test_prediction == 1,
    "positive",
    "negative"
)


test_prediction_output.to_csv(
    "XGB_1v9_test_predictions.csv",
    index=False
)


# ==========================================================
# 16. Save model and model metadata
# ==========================================================

joblib.dump(
    final_model,
    MODEL_OUTPUT
)


model_metadata = {

    "feature_cols": feature_cols,

    "label_mapping": label_mapping,

    "random_state": RANDOM_STATE,

    "positive_negative_ratio": "1:9",

    "classification_threshold": 0.5,

    "best_cv_auc": study.best_value,

    "best_params": best_params
}


joblib.dump(
    model_metadata,
    METADATA_OUTPUT
)


print("\nModel saved:", MODEL_OUTPUT)

print(
    "Model metadata saved:",
    METADATA_OUTPUT
)

print("\nFinished!")
