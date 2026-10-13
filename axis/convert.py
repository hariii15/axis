import pyarrow.parquet as pq

table = pq.read_table("purchase_requisitions.parquet")
df = table.to_pandas()

df.to_csv(
    "purchase_requisitions_clean.txt",
    sep="\t",
    index=False
)