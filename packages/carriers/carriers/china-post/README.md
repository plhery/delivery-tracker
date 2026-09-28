# China Post

China Post parcels use the [universal providers](../../providers/README.md).
EMS has a separate [official adapter](../ems/README.md). Source selection is
covered in [ROUTING.md](../../../../docs/ROUTING.md); provider results are in
[COVERAGE.md](../../providers/COVERAGE.md).

## How it works

The official tracker at [ems.com.cn](https://www.ems.com.cn/queryList) requires
four ordered Chinese-character clicks before each lookup. Its current
`WORD_IMAGE_CLICK` challenge differs from older slider implementations.
Public request headers and a challenge identifier do not prove acceptance.

A normal browser can reach the form, while plain HTTP can receive a block page.
The anonymous preview is partial; full history requires login. No automatic,
identity-bound retrieval through this challenge is supported.

## Limitations

The EMS partner API requires issued customer credentials. Third-party pages
that embed 17TRACK provide the same source already available through the
universal adapter. Neither supplies an independent anonymous carrier feed.

## Testing

Provider live-test inputs and commands are documented in the
[provider READMEs](../../providers/README.md).
