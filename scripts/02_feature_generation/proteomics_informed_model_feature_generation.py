import numpy as np
import pandas as pd
from scipy import integrate as spint
from concurrent.futures import ProcessPoolExecutor, as_completed
from itertools import islice
import os
import time
import warnings

warnings.filterwarnings("ignore", category=spint.IntegrationWarning)


# ============================================================
# Features definition
# ============================================================

IMP_FEATURES = [
    "euclidean",
    "mae",
    "absdiff_std",
    "reldiff_mean",
    "pearson_0",
    "pearson_1",
    "pearson_2",
]


RAW_FEATURES = [
    "absdiff_max",
    "reldiff_max",
    "logdiff_mean",
    "logdiff_median",
    "pearson_3",
    "pearson_4",
    "pearson_5",
    "pearson_6",
    "zscore_prot1",
    "zscore_prot2",
]


FINAL_FEATURES = [
    "imp_euclidean",
    "imp_mae",
    "imp_absdiff_std",
    "imp_reldiff_mean",
    "imp_pearson_0",
    "imp_pearson_1",
    "imp_pearson_2",

    "raw_absdiff_max",
    "raw_reldiff_max",
    "raw_logdiff_mean",
    "raw_logdiff_median",
    "raw_pearson_3",
    "raw_pearson_4",
    "raw_pearson_5",
    "raw_pearson_6",
    "raw_zscore_prot1",
    "raw_zscore_prot2",
]


# ============================================================
# basic functions
# ============================================================

def safe_mean(x):
    x = np.asarray(x)
    x = x[~np.isnan(x)]

    if len(x) == 0:
        return np.nan

    return np.mean(x)


def safe_max(x):
    x = np.asarray(x)
    x = x[~np.isnan(x)]

    if len(x) == 0:
        return np.nan

    return np.max(x)


def safe_std(x):
    x = np.asarray(x)
    x = x[~np.isnan(x)]

    if len(x) == 0:
        return np.nan

    return np.std(x)


def safe_median(x):
    x = np.asarray(x)
    x = x[~np.isnan(x)]

    if len(x) == 0:
        return np.nan

    return np.median(x)



def safe_corr(a, b):

    n = min(len(a), len(b))

    a = np.asarray(a[:n])
    b = np.asarray(b[:n])


    mask = (
        ~np.isnan(a)
        &
        ~np.isnan(b)
    )


    a = a[mask]
    b = b[mask]


    if len(a) < 2:
        return 0.0


    r = np.corrcoef(a, b)[0,1]

    if np.isnan(r):
        return 0.0

    return r



# ============================================================
# derivative and integral
# ============================================================

def derivative_curve(x,y):

    mask = (
        ~np.isnan(x)
        &
        ~np.isnan(y)
    )


    x = x[mask]
    y = y[mask]


    if len(y)<2:
        return np.array([])


    dy=np.diff(y)


    if len(dy)>0:

        r=dy.max()-dy.min()

        if r!=0:
            dy=(dy-dy.min())/(r+1e-8)


    return dy




def integral_curve(x,y):

    mask=(
        ~np.isnan(x)
        &
        ~np.isnan(y)
    )

    x=x[mask]
    y=y[mask]

    if len(y)<2:
        return np.array([])

    yi=np.array([
        spint.trapezoid(
            y[i:i+2],
            x[i:i+2]
        )
        for i in range(len(y)-1)
    ])

    if len(yi)>0:

        r=yi.max()-yi.min()

        if r!=0:
            yi=(yi-yi.min())/(r+1e-8)

    return yi

# ============================================================
# zscore calculation
# ============================================================

def build_distance_stats(prot_curves):

    proteins = prot_curves.columns.tolist()

    dist_matrix = pd.DataFrame(
        np.nan,
        index=proteins,
        columns=proteins
    )

    for i in range(len(proteins)):
        for j in range(i+1,len(proteins)):
            a = prot_curves[proteins[i]].values.astype(float)
            b = prot_curves[proteins[j]].values.astype(float)

            mask = (
                ~np.isnan(a)
                &
                ~np.isnan(b)
            )

            if mask.sum()==0:
                continue

            d = np.linalg.norm(
                a[mask]-b[mask]
            )

            dist_matrix.iloc[i,j]=d
            dist_matrix.iloc[j,i]=d


    mean_std={}

    for p in proteins:
        values = (
            dist_matrix[p]
            .drop(p)
            .dropna()
        )

        if len(values)==0:
            mean_std[p]=(0,1)

        else:
            mean_std[p]=(
                values.mean(),
                values.std()
            )

    return dist_matrix, mean_std


def compute_zscore(
    p1,
    p2,
    dist_matrix,
    mean_std
):
    d = dist_matrix.loc[p1,p2]

    mu1,std1 = mean_std[p1]
    mu2,std2 = mean_std[p2]

    if std1==0 or np.isnan(std1):
        std1=1

    if std2==0 or np.isnan(std2):
        std2=1

    z1=(d-mu1)/(std1+1e-8)
    z2=(d-mu2)/(std2+1e-8)

    return z1,z2




# ============================================================
# calculate one protein pair
# ============================================================

def compute_pair_features(
    args
):
    p1,p2,prot_curves,x,dist_matrix,mean_std,prefix=args

    if (
        p1 not in prot_curves.columns
        or
        p2 not in prot_curves.columns
    ):
        return None

    y1=prot_curves[p1].values.astype(float)
    y2=prot_curves[p2].values.astype(float)

    mask=(
        ~np.isnan(y1)
        &
        ~np.isnan(y2)
    )

    y1v=y1[mask]
    y2v=y2[mask]

    xv=x[mask]

    result={
        "Protein1":p1,
        "Protein2":p2
    }


    # ========================================================
    # common difference features
    # ========================================================
    diff=np.abs(y1v-y2v)

    if prefix=="imp":

        result["imp_euclidean"] = (
            np.linalg.norm(
                y1v-y2v
            )
            if len(y1v)>0
            else np.nan
        )

        result["imp_mae"] = safe_mean(diff)
        result["imp_absdiff_std"] = safe_std(diff)

        rel_diff = (
            diff /
            (
                np.abs(y1v)
                +
                np.abs(y2v)
                +
                1e-8
            )
        )

        result["imp_reldiff_mean"] = safe_mean(rel_diff)

        # pearson0
        result["imp_pearson_0"] = safe_corr(
            y1v,
            y2v
        )

        # pearson1 derivative correlation
        dy1=derivative_curve(
            xv,
            y1v
        )

        dy2=derivative_curve(
            xv,
            y2v
        )

        result["imp_pearson_1"] = safe_corr(
            dy1,
            dy2
        )

        # pearson2 integral correlation
        iy1=integral_curve(
            xv,
            y1v
        )

        iy2=integral_curve(
            xv,
            y2v
        )

        result["imp_pearson_2"] = safe_corr(
            iy1,
            iy2
        )

    # ========================================================
    # raw features
    # ========================================================

    else:
        result["raw_absdiff_max"] = safe_max(diff)

        rel_diff=(
            diff /
            (
                np.abs(y1v)
                +
                np.abs(y2v)
                +
                1e-8
            )
        )

        result["raw_reldiff_max"] = safe_max(rel_diff)

        log_diff=np.log1p(diff)

        result["raw_logdiff_mean"] = safe_mean(
            log_diff
        )

        result["raw_logdiff_median"] = safe_median(
            log_diff
        )

        dy1=derivative_curve(
            xv,
            y1v
        )

        dy2=derivative_curve(
            xv,
            y2v
        )

        # expression vs derivative

        result["raw_pearson_3"] = safe_corr(
            y1v[:-1],
            dy1
        )

        result["raw_pearson_4"] = safe_corr(
            y2v[:-1],
            dy2
        )

        iy1=integral_curve(
            xv,
            y1v
        )

        iy2=integral_curve(
            xv,
            y2v
        )

        result["raw_pearson_5"] = safe_corr(
            y1v[:-1],
            iy1
        )

        result["raw_pearson_6"] = safe_corr(
            y2v[:-1],
            iy2
        )

        z1,z2=compute_zscore(
            p1,
            p2,
            dist_matrix,
            mean_std
        )

        result["raw_zscore_prot1"]=z1
        result["raw_zscore_prot2"]=z2

    return result



# ============================================================
# batch iterator
# ============================================================

def batch_iterator(
    iterable,
    size
):

    iterator=iter(iterable)

    while True:
        batch=list(
            islice(
                iterator,
                size
            )
        )

        if not batch:
            break

        yield batch



# ============================================================
# feature extraction
# ============================================================

def extract_features(
    expr_file,
    pair_file,
    output_file,
    prefix,
    batch_size=5000,
    max_workers=64
):

    print(
        "Reading:",
        expr_file
    )

    df=pd.read_csv(expr_file)

    df=df.drop_duplicates(
        subset=["protein.id"]
    )

    for c in df.columns[1:]:
        df[c]=pd.to_numeric(
            df[c],
            errors="coerce"
        )

    prot_curves=df.set_index(
        "protein.id"
    ).T

    x=np.arange(
        len(prot_curves)
    )

    # raw only需要zscore
    if prefix=="raw":

        dist_matrix,mean_std=build_distance_stats(
            prot_curves
        )

    else:

        dist_matrix=None
        mean_std=None

    pairs=pd.read_csv(
        pair_file
    )

    pairs=pairs.rename(
        columns={
            "mus_p1":"Protein1",
            "mus_p2":"Protein2"
        }
    )

    protein_pairs=pairs[
        [
            "Protein1",
            "Protein2"
        ]
    ].values.tolist()


    results=[]

    for i,batch in enumerate(
        batch_iterator(
            protein_pairs,
            batch_size
        ),
        1
    ):
        args=[

            (
                p1,
                p2,
                prot_curves,
                x,
                dist_matrix,
                mean_std,
                prefix
            )
            for p1,p2 in batch
        ]

        with ProcessPoolExecutor(
            max_workers=max_workers
        ) as executor:
            futures=[
                executor.submit(
                    compute_pair_features,
                    a
                )
                for a in args
            ]

            for f in as_completed(futures):

                r=f.result()

                if r is not None:

                    results.append(r)

        print(
            f"Batch {i} finished"
        )

    out=pd.DataFrame(results)

    out.to_csv(
        output_file,
        index=False
    )

    print(
        "Saved:",
        output_file
    )


# ============================================================
# main
# ============================================================

if __name__=="__main__":

    pair_file = (
        "/home/yangly/PPI/"
        "00_rawData/"
        "01_pairs.csv"
    )

    output_dir = (
        "/home/yangly/PPI/"
        "01_Results_analysis/"
        "00_feature/"
        "02_features/"
    )



    # -----------------------------
    # raw
    # -----------------------------

    extract_features(

        expr_file=
        "/home/luoht/ppi_label/feature_extract/raw_ave.csv",

        pair_file=pair_file,

        output_file=
        output_dir+
        "raw_features.csv",

        prefix="raw",

        batch_size=5000,

        max_workers=64
    )



    # -----------------------------
    # imp
    # -----------------------------

    extract_features(

        expr_file=
        "/home/luoht/ppi_label/feature_extract/impseq_ave.csv",

        pair_file=pair_file,

        output_file=
        output_dir+
        "imp_features.csv",

        prefix="imp",

        batch_size=5000,

        max_workers=64
    )



    # -----------------------------
    # merge final 17 features
    # -----------------------------
    raw=pd.read_csv(
        output_dir+
        "raw_features.csv"
    )


    imp=pd.read_csv(
        output_dir+
        "imp_features.csv"
    )


    final=pd.merge(
        imp,
        raw,
        on=[
            "Protein1",
            "Protein2"
        ],
        how="inner"
    )


    final=final[
        [
            "Protein1",
            "Protein2"
        ]
        +
        FINAL_FEATURES
    ]


    final.to_csv(

        output_dir+
        "final_features.csv",

        index=False

    )

    print(
        "Finished all 17 features!"
    )