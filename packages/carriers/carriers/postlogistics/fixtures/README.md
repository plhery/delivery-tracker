`delivered.json`: a `Type: 1` barcode answer for a delivered shipment
(announcement, transit and delivery scans, a planned delivery date) plus the
recipient and signature blocks the parser must drop. Constructed after the
response shape; the barcode, names, address and signature URL are synthetic.

`relayed-swiss-post.json`: a `Type: 3` answer relaying two Swiss Post scans for
a Swiss Post parcel barcode (placeholder `PST` codes, no place, UTC times), in
the endpoint's shape. The barcode and times are synthetic.
