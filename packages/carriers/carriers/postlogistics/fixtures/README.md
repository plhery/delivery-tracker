`delivered.json`: a `Type: 1` barcode answer for a delivered shipment
(announcement, transit and delivery scans, a planned delivery date) plus the
recipient and signature blocks the parser must drop. Constructed after the
response shape; the barcode, names, address and signature URL are synthetic.

`relayed-swiss-post.json`: a `Type: 3` answer relaying two Swiss Post scans for
a Swiss Post parcel barcode (placeholder `PST` codes, no place, UTC times), in
the endpoint's shape. The barcode and times are synthetic.

`shared-reference.json`: a `Type: 2` answer for a customer reference that
unrelated shipments share: three delivered shipments years apart and one
two-barcode consignment, with offset-less times as the endpoint sends them and
the `GeoLocation` delivery place the parser must drop. Barcodes, places and times
are synthetic; the Swiss Post Cargo folder holds the same file.
