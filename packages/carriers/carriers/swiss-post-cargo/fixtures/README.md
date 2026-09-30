`delivered.json`: a `Type: 1` response for a delivered shipment (`DLV` and `RFS`
rows, Swiss wall-clock times without an offset) plus the consignee and
`FullDescription` fields the parser must drop. Constructed in the public
endpoint's shape; the identifier, names and times are synthetic.

`relayed-swiss-post.json`: a `Type: 3` response relaying two Swiss Post scans for
a Swiss Post parcel barcode (placeholder `PST` codes, no place, UTC times), in
the endpoint's shape. The barcode and times are synthetic.

`shared-reference.json`: a `Type: 2` response for a customer reference that
unrelated shipments share, shaped like the answer to the tracking form's example
`12345678`: three delivered shipments years apart and one two-barcode
consignment. Times carry no offset, as the endpoint sends them; rows include the
`GeoLocation` delivery place and a `FullDescription` the parser must drop.
Barcodes, places and times are synthetic.
