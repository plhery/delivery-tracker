# PostNL fixtures

- `delivered.json`: `tracking-items` answer for a delivered international parcel, with the
  recipient and signature fields the parser must drop. Constructed from the live shape (local
  times with a trailing `Z`); the number, shop, names, address and signature URL are synthetic.
