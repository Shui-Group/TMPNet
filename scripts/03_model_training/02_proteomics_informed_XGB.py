# ==========================================================
# 1. Load packages
# ==========================================================
import pandas as pd
import numpy as np

import joblib
import optuna

from xgboost import XGBClassifier
from sklearn.model_selection import (
    StratifiedKFold,
    cross_val_predict
)
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import (
    roc_auc_score,
    accuracy_score,
    precision_score,
    recall_score,
    f1_score
)


# ==========================================================
# 2. Load training and testing data
# ==========================================================

train_df = read_csv(
    "training_set.csv"
)

test_df = read_csv(
    "testing_set.csv"
)

# ==========================================================
# 3. Define all features
#
# Automatically extract feature columns
#
# ==========================================================

remove_columns = [
    "Protein1",
    "Protein2",
    "Truth",
    "pair"
]

feature_cols = [
    col for col in train_df.columns
    if col not in remove_columns
]

X_train_all = train_df[feature_cols]
X_test_all = test_df[feature_cols]

y_train_all = LabelEncoder().fit_transform(
    train_df["Truth"]
)

y_test = LabelEncoder().fit_transform(
    test_df["Truth"]
)


# ==========================================================
# 4. Generate 1:9 training dataset
#
# Positive : Negative = 1 : 9
#
# ==========================================================
positive_train = train_df[
    train_df["Truth"]=="positive"
]

negative_train = train_df[
    train_df["Truth"]=="negative"
]


negative_sample = negative_train.sample(
    n=len(positive_train)*9
)

train_df_1v9 = pd.concat(
    [
        positive_train,
        negative_sample
    ]
).sample(
    frac=1
)

X_train = train_df_1v9[feature_cols]

y_train = LabelEncoder().fit_transform(
    train_df_1v9["Truth"]
)


# ==========================================================
# 5. Optuna objective
# ==========================================================

def objective(trial):
    params = {
        "n_estimators":
            trial.suggest_int(
                "n_estimators",
                100,
                500
            ),

        "max_depth":
            trial.suggest_int(
                "max_depth",
                3,
                10
            ),

        "learning_rate":
            trial.suggest_float(
                "learning_rate",
                0.01,
                0.3
            ),

        "subsample":
            trial.suggest_float(
                "subsample",
                0.5,
                1.0
            ),

        "colsample_bytree":
            trial.suggest_float(
                "colsample_bytree",
                0.5,
                1.0
            ),

        "tree_method":
            "hist",

        "eval_metric":
            "logloss",

        "n_jobs":
            25
    }

    model = XGBClassifier(
        **params
    )

    cv = StratifiedKFold(
        n_splits=5,
        shuffle=True
    )

    # probability prediction
    #
    # important for AUROC

    y_prob = cross_val_predict(
        model,
        X_train,
        y_train,
        cv=cv,
        method="predict_proba"
    )[:,1]

    auc = roc_auc_score(
        y_train,
        y_prob
    )
    return auc


# ==========================================================
# 6. Run Optuna
# ==========================================================
study = optuna.create_study(
    direction="maximize"
)

study.optimize(
    objective,
    n_trials=30
)

best_params = study.best_params


# ==========================================================
# 7. Train final XGB model
# ==========================================================

final_model = XGBClassifier(
    **best_params,
    tree_method="hist",
    eval_metric="logloss",
    n_jobs=25
)

final_model.fit(
    X_train,
    y_train
)

# ==========================================================
# 8. Save model
# ==========================================================

joblib.dump(
    final_model,
    "XGB_1v9.joblib"
)