# Correios CAPTCHA model

`captcha.onnx` is a fixed-batch inference export of
[opastorello/correios-rastreamento](https://github.com/opastorello/correios-rastreamento/tree/b791490479c6b2ec7c374539116369cb8d5b2c58/app/captcha)'s
`captcha_model.pt`. The upstream repository distributes the model under the
[MIT license](LICENSE). Its copyright and license are retained here.

The export uses the upstream `CaptchaModel` architecture, evaluation mode,
opset 17, input `image` with shape `[1,1,80,215]`, and output `logits` with
shape `[53,1,37]`. It contains inference weights only. Runtime decoding and
image bounds are implemented in [ocr-worker.mjs](../ocr-worker.mjs).
