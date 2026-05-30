import json
import pandas as pd
import xgboost as xgb
from sklearn.metrics import roc_auc_score, precision_score, recall_score

from feature_engineering import prepare_features, FEATURE_COLUMNS


TARGET = "stress_event_next_3h"


def main():
    df = pd.read_csv("data/raw/synthetic_grid.csv")
    df = prepare_features(df)

    df.to_parquet("data/processed/training_features.parquet", index=False)

    df = df.sort_values("timestamp")

    split_index = int(len(df) * 0.8)

    train = df.iloc[:split_index]
    test = df.iloc[split_index:]

    X_train = train[FEATURE_COLUMNS]
    y_train = train[TARGET]

    X_test = test[FEATURE_COLUMNS]
    y_test = test[TARGET]

    dtrain = xgb.DMatrix(X_train, label=y_train)
    dtest = xgb.DMatrix(X_test, label=y_test)

    params = {
    "objective": "binary:logistic",
    "eval_metric": ["auc", "logloss"],
    "tree_method": "hist",
    "device": "cpu",
    "max_depth": 5,
    "eta": 0.05,
    "subsample": 0.85,
    "colsample_bytree": 0.85,
    "min_child_weight": 5,
    }

    model = xgb.train(
        params=params,
        dtrain=dtrain,
        num_boost_round=500,
        evals=[(dtrain, "train"), (dtest, "test")],
        early_stopping_rounds=40,
        verbose_eval=50,
    )

    preds = model.predict(dtest)
    pred_labels = (preds >= 0.5).astype(int)

    auc = roc_auc_score(y_test, preds)
    precision = precision_score(y_test, pred_labels)
    recall = recall_score(y_test, pred_labels)

    print("AUC:", auc)
    print("Precision:", precision)
    print("Recall:", recall)

    model.save_model("artifacts/grid_stress_xgb.json")

    with open("artifacts/feature_columns.json", "w") as f:
        json.dump(FEATURE_COLUMNS, f, indent=2)

    print("Saved artifacts/grid_stress_xgb.json")
    print("Saved artifacts/feature_columns.json")


if __name__ == "__main__":
    main()