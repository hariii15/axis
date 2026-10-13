import json
import pandas as pd

# 1. Load your JSON payload
json_data = {
    "data": {
        "rows": [
            {"id": "REQ-0000001"},
            {"id": "REQ-0000002"},
            # ... (all 100 rows go here)
            {"id": "REQ-0000100"}
        ],
        "rowCount": 100
    },
    "meta": {
        "model": "PurchaseRequisitions",
        "limit": 100
    }
}

# 2. Extract the data array directly into a DataFrame
df = pd.DataFrame(json_data["data"]["rows"])

# 3. Export to a binary Parquet file
df.to_parquet("purchase_requisitions.parquet", index=False, compression="snappy")

print("Conversion complete: 'purchase_requisitions.parquet' saved successfully.")
