`delivered.json`: a `Type: 1` response for a delivered shipment (`DLV` and `RFS`
rows) plus the consignee and `FullDescription` fields the parser must drop.
Constructed in the public endpoint's shape; the identifier and names are synthetic.

`relayed-swiss-post.json`: a `Type: 3` response relaying two Swiss Post scans for
a Swiss Post parcel barcode (placeholder `PST` codes, no place, UTC times), in
the endpoint's shape. The barcode and times are synthetic.
