---
title: Estados de un envío: qué significa cada uno
description: Qué significan los estados de un envío, en el orden en que aparecen: cómo los llaman Correos, GLS y SEUR y en cuáles tienes que hacer algo.
slug: estados-de-envio-significado
picture: Una ruta con curvas y paradas ya completadas (etiqueta, almacén, avión), una furgoneta en la parada actual, una casa más adelante y Pip corriendo.
published: 2026-10-09
updated: 2026-10-09
---

Un estado de seguimiento es el último escaneo del transportista resumido en pocas palabras, y casi ninguno te pide nada. «Pre-admisión» o «Etiqueta creada» quieren decir que el transportista aún no tiene tu paquete; «En tránsito», que está en algún punto entre dos escaneos, y «En reparto», que va hoy con el repartidor. Solo unos pocos te necesitan: un intento de entrega fallido, un paquete que te espera en una oficina o un punto de recogida, un pago de aduanas y un «Entregado» cuando a ti no te ha llegado nada.

## ¿Cuáles son las fases del seguimiento de un paquete?

Todos los paquetes pasan por las mismas paradas, y los que vienen del extranjero, por tres más.

:::journey
- label | Etiqueta creada | El transportista tiene los datos, no el paquete.
- warehouse | En tránsito | Recogido y de centro en centro, sin escaneos en la carretera.
- plane | Sale del país | Solo del extranjero. En el aire no hay escaneos.
- customs | Aduanas | Solo de fuera de la UE o con Canarias, Ceuta y Melilla. A veces hay que pagar.
- handover | Transportista local | Solo del extranjero. Sus escaneos pueden salir solo en su web.
- truck | En reparto | En la furgoneta de hoy.
- locker | Para recoger | En una oficina, una tienda o un locker.
- home | Entregado | En tus manos, o donde el transportista lo da por entregado.
:::

## ¿Qué significan los estados de Correos, GLS y SEUR?

Las mismas fases, con otras palabras:

| Fase | Correos | GLS |
| --- | --- | --- |
| Etiqueta creada | `Pre-admisión` o `Prerregistrado` | `Etiqueta creada` |
| Recogido | `Admitido` | `Envío recogido por GLS` |
| En tránsito | `En tránsito`, `Clasificado`, `Alta en la unidad de reparto` | `En tránsito` |
| En reparto | `En reparto` | `En reparto` |
| Para recoger | `A disposición del destinatario` | `Depositado en Parcel Shop` |
| Entregado | `Entregado` | `Entregado` |

Correos agrupa sus estados en cuatro fases: `Pre-admisión`, `En Camino`, `En entrega` y `Entregado`. SEUR escribe frases enteras en mayúsculas: `EL ENVÍO HA SIDO REGISTRADO.` cuando solo tiene los datos, `EL ENVÍO ESTÁ EN REPARTO.` el día de la entrega y `EL ENVÍO ESTÁ DISPONIBLE PARA RECOGER EN EL PUNTO SEUR PICKUP.` cuando te espera en una tienda.

## «Pre-admisión» o «etiqueta creada»: ¿lo tiene ya el transportista?

No: la tienda ha impreso una etiqueta y ha mandado los datos, nada más. Correos explica que `Pre-admisión` se genera cuando se prerregistra el envío: ya existe el número, pero el paquete está «pendiente de ser entregado a Correos». En el seguimiento también puede salir como `Prerregistrado`. GLS dice lo mismo de `Etiqueta creada`: tiene el prerregistro, pero el paquete todavía no está en su red ni en ninguna de sus instalaciones.

En SEUR pueden pasar hasta 48 horas desde que recibe el paquete hasta que ves su estado en la web. Y también ocurre al revés: si a Correos le llega un paquete sin prerregistro, lo deja «estacionado» y lo entrega cuando la empresa que lo envía le pasa los datos.

Si lleva varios días sin cambiar, pregunta a la tienda, no al transportista. GLS no puede darte plazos hasta tener el paquete físicamente, y tanto GLS como SEUR te dicen que hables con el remitente.

## ¿Qué significa «en tránsito»?

Que el transportista tiene tu paquete en algún punto de su red. No quiere decir que se esté moviendo ahora mismo: el `En tránsito` de SEUR puede significar que va camino de la delegación que reparte en tu zona o que ya está allí, esperando a salir a reparto. Tampoco es «en reparto»: ese estado solo sale cuando el paquete ya va con el repartidor. En Correos, `En tránsito` aparece al salir del centro logístico de origen y otra vez cuando va hacia la unidad que lo entregará; entre medias, `Clasificado` quiere decir que lo han clasificado y asignado a un transporte.

Entre centros, el silencio (y algún rodeo) es normal:

- GLS explica que usa varios centros de distribución, así que la ruta no siempre es directa.
- UPS avisa de que, en trayectos largos, es probable que no lo vuelva a escanear hasta el centro de destino.
- Para FedEx, pasar más de 24 horas sin un escaneo no es raro.

### ¿Cuánto tarda un paquete en tránsito?

GLS suele entregar los envíos nacionales en 24 horas laborables desde que tiene el paquete en su red (sin contar las islas), y los de Europa, en 24 a 96 horas. InPost intenta entregar en un plazo medio de 3 días laborables desde que el paquete entra en un Punto Pack o un Locker en España. ¿Lleva más tiempo parado del que da el transportista? Mira [por qué el seguimiento deja de actualizarse](guide:tracking-not-updating).

## Paquetes del extranjero: salida del país, aduanas y transportista local

- **Sale del país.** Lo cargan en un avión, un barco o un tren. DHL explica que viaja dentro de un contenedor y que los paquetes se vuelven a escanear uno a uno ya en el país de destino. En el seguimiento de Correos verás líneas como `Salida de oficina de cambio` y, ya en el país de llegada, `Salida de oficina de cambio de destino`.
- **Aduanas.** Según Correos, pasa por aduanas todo lo que llega a la Península y Baleares desde fuera de la UE o desde Canarias, Ceuta y Melilla, y todo lo que entra en esos tres territorios. En su seguimiento verás `Inicio de tramitación aduanera` o `Pendiente de tramitación aduanera`. Casi siempre es un trámite: DHL, en su web alemana, habla de varios días laborables según la documentación, y ningún transportista da un máximo general. Desde el 1 de julio de 2026, una compra de hasta 150 € que llega de fuera de la UE a la Península, Baleares o Canarias paga un arancel de 3 € por cada tipo de producto, aunque la tienda ya te haya cobrado el IVA. Correos lo muestra como `Arancel UE`, con su importe, y no entrega el paquete sin cobrarlo, salvo que el vendedor lo pagara por adelantado. Paga solo lo que te pidan: entrando tú en la App de Correos o en la web Mi Oficina hasta que empiece la entrega, o después al cartero o en la oficina. El resto está en [paquetes retenidos en aduanas](guide:customs).
- **Transportista local.** Cuando otra empresa hace el último tramo, DHL te remite al seguimiento del transportista del país de destino. ¿Has pedido en AliExpress, Temu o Shein? Mira [cómo seguir un paquete que viene de China](guide:tracking-from-china).

## ¿«En reparto» significa que llega hoy?

Normalmente, sí:

- **Correos:** `En reparto` quiere decir que el repartidor ya está haciendo su ruta. Si te llega un SMS de entrega en domicilio, Correos cuenta con entregarlo entre 24 y 72 horas después, según el producto.
- **GLS:** reparte de lunes a viernes, más o menos de 9 a 20 h; los sábados, antes de mediodía, solo con Express Saturday. Con `En reparto`, su seguimiento muestra una franja estimada, y cuando quedan menos de 10 paradas se activa el seguimiento en tiempo real.
- **SEUR:** con SEUR Predict te avisa el mismo día, por email o SMS, de una franja estimada de 1 hora, y todavía puedes cambiar la fecha o la dirección, o pedir que lo dejen en una tienda SEUR Pickup.
- **UPS:** salvo que el remitente haya contratado una entrega con horario definido, reparte en domicilios normalmente entre las 9:00 y las 19:00, y a veces más tarde.

Ojo con un estado que despista: en una entrega a domicilio, `Alta en la unidad de reparto` significa que el paquete ha llegado a la unidad de Correos que lo entregará «en cuanto sea posible», no que ya vaya en la furgoneta.

[Peek](/) consulta el seguimiento hasta una vez cada 2 minutos cuando un paquete está en reparto (y hasta una vez cada 10 minutos el resto del tiempo), y puedes dejar sus avisos en «Solo el día de entrega».

## «Intento de entrega» o «ausente»: ¿y ahora qué?

Este sí te necesita: no había nadie para recibir el paquete o el repartidor no pudo llegar a la puerta. En Correos aparece como `Realizado intento de entrega` o `Intento de entrega. Ausente`, normalmente después de un primer intento que no se completó por ausencia, un problema con la dirección u otro inconveniente. SEUR lo escribe `EL ENVÍO NO SE HA ENTREGADO POR AUSENCIA O CIERRE…`.

:::steps
- Lee el aviso | Papel en el buzón, SMS o email: dónde está el paquete y qué número dar.
- Mira el plazo | De 5 a 15 días según el transportista, y cada uno los cuenta desde un momento distinto.
- Cambia la entrega | En la web o la app del propio transportista, si lo permite: otro día o un punto de recogida.
- Recoge con tu DNI | Lleva el DNI y el aviso o el código. En Correos puede ir otra persona con tu autorización, su DNI y una fotocopia del tuyo.
:::

| Transportista | Tras un intento fallido | Tiempo para recogerlo |
| --- | --- | --- |
| Correos | Aviso de llegada en el buzón, o SMS o email. Si el envío incluye dos intentos, el segundo es en 24 horas; si no hay segundo o también falla, va a una oficina | 15 días en la oficina si te avisa por SMS, desde el día siguiente al mensaje; con aviso en papel, el plazo que indica el aviso. 5 días naturales en un Citypaq |
| SEUR | Normalmente, a la tienda SEUR Pickup más cercana | 7 días en tienda Pickup y 5 en locker, desde el aviso |
| GLS | Con EconomyParcel, un solo intento y luego al Parcel Shop más cercano; según el servicio, un segundo intento | Si el segundo falla, se queda en la agencia y vuelve al remitente 7 días naturales después del primer intento |
| InPost | A domicilio, su agencia de reparto se pone en contacto contigo para concertar una nueva cita | 5 días naturales en Locker y Punto Pack (envíos nacionales) |

> Correos nunca pide datos personales o bancarios ni pagos por SMS o correo electrónico, y avisa de que los engaños que más usan su nombre te piden un pago o que completes la dirección de entrega para recibir un paquete. Cambia la entrega o paga solo en la web o la app del transportista, entrando tú, nunca desde el enlace de un mensaje.

## «A disposición del destinatario» o «para recoger»: ¿dónde está?

En una oficina, una tienda o un locker, hasta que acabe el plazo de la tabla de arriba. Correos usa `A disposición del destinatario` tanto para la oficina como para la taquilla Citypaq; GLS, `Depositado en Parcel Shop`. InPost te manda un email o un SMS cuando el paquete llega al Punto Pack o al Locker, y SEUR te manda por email o SMS el PIN del locker en cuanto lo deposita.

Espera a ese estado o al aviso antes de ir: en Correos, el envío no está en la oficina hasta el día siguiente al SMS, o hasta el siguiente día laborable si te dejaron el aviso en papel. En un Punto Pack de InPost puedes enseñar el DNI, el pasaporte o el carnet de conducir. En SEUR puede ir otra persona si le pasas la notificación con el código QR o el PIN.

## ¿«Entregado» significa que lo tienes tú?

No siempre. Significa que el repartidor lo ha escaneado como entregado:

- **A otra persona.** SEUR avisa de que puede haberlo dado a otra persona en la dirección que indicó el remitente, y su seguimiento tiene hasta un estado para eso: `EL ENVÍO HA SIDO ENTREGADO A UN VECINO.` Si nadie lo tiene, su teléfono gratuito de Atención al Consumidor es el 800 00 95 84.
- **En un lugar seguro.** Si no hacía falta firma, el repartidor de UPS lo deja en un sitio resguardado, como una puerta lateral o una zona de aparcamiento, y en ups.com/track puedes ver una foto del sitio exacto.
- **En una tienda.** Si elegiste recogerlo en un Parcel Shop de GLS, GLS te dice que vayas cuando el seguimiento marque `Depositado en Parcel Shop` o `Entregado`: ahí, «entregado» quiere decir que está en la tienda, no en tus manos. Lleva un documento oficial.

¿No está? Revisa el historial completo por si da un nombre o un lugar, y después mira [paquete entregado pero no recibido](guide:delivered-not-received).

## ¿Una incidencia significa que se ha perdido?

No. Correos llama «envío estacionado» al que tiene una incidencia que impide entregarlo: un paquete roto o dañado, datos del destinatario insuficientes, una dirección incorrecta o desconocida, que nadie se haga cargo o que falte el prerregistro. Lo guarda 5 días naturales a la espera de que se corrijan los datos, y puedes corregirlos tú en «Gestión de estacionados» con el número de envío y el PIN que te manda por SMS o email. Si no tienes PIN, habla con la empresa que te lo envía: ella se encarga del trámite.

En SEUR, `EL ENVÍO HA SUFRIDO UN RETRASO Y ES POSIBLE QUE SE DEMORE LA ENTREGA…` avisa de un retraso, no de una pérdida. UPS usa `Excepción` cuando algo inesperado puede cambiar la fecha de entrega, y da el motivo en «Progreso del envío», dentro del detalle del seguimiento.

Eso sí, fíjate bien si el motivo es la dirección o un pago. En Correos, corrige un estacionado dentro de esos 5 días naturales; si te lo envía un particular, es él quien tiene que llamar a Atención al Cliente antes de que pasen.

## ¿Por qué me han devuelto el paquete al remitente?

Los motivos que dan los transportistas: no lo recogiste a tiempo, la dirección estaba mal o incompleta, lo rehusaste, no se pagaron los gastos de aduanas o llegó dañado. Así lo cuenta cada uno:

- **Correos:** `Finalizado plazo retirada` no dice «devuelto», pero lo es: se acabó el plazo para recogerlo, y Correos lo devuelve al remitente.
- **GLS:** si el segundo intento falla, el paquete se queda en la agencia y vuelve 7 días naturales después del primer intento.
- **InPost:** pasados los 5 días en el Locker o el Punto Pack, vuelve al remitente (tienda online, vendedor o particular).

Si ya va de vuelta, habla con la tienda: SEUR, por ejemplo, te dice que contactes con el remitente para cualquier gestión. Pídele que te lo vuelva a enviar o que te devuelva el dinero.

:::sources
- [Correos: Sigue tu paquete con el Localizador de Envíos](https://www.correos.es/es/es/actualidad/2023/sigue-tu-paquete-en-tiempo-real-con-nuestra-herramienta-de-local) – estados y fases
- [Correos: Aviso de llegada y SMS](https://www.correos.es/es/es/atencion-al-cliente/recibir/aviso-de-llegada) – segundo intento, 24 a 72 horas, 15 días, DNI y autorización, devolución al acabar el plazo
- [Correos: Oficina o Citypaq](https://www.correos.es/es/es/actualidad/2026/oficina-o-citypaq--elige-el-metodo-de-recogida-que-mejor-se-adap) – 5 días naturales en Citypaq
- [Correos: Envíos estacionados](https://www.correos.es/es/es/atencion-al-cliente/recibir/envios-estacionados) – incidencias, prerregistro, 5 días naturales, Gestión de estacionados
- [Correos: Información aduanera](https://www.correos.es/es/es/atencion-al-cliente/informacion-aduanera) – qué pasa por aduanas
- [Correos: Arancel para envíos de bajo valor en la UE](https://www.correos.es/es/es/atencion-al-cliente/informacion-aduanera/arancel-para-envios-de-bajo-valor-en-la-ue) – 3 € por tipo de producto, Arancel UE, IVA ya pagado, pago anticipado, formas de pago
- [Correos: Qué es el phishing](https://www.correos.es/es/es/atencion-al-cliente/seguridad-de-la-informacion/phishing) – nunca pide datos ni pagos por SMS o email
- [Universal Parcel Scraper: estados de Correos](https://github.com/plhery/universal-parcel-scraper/blob/main/carriers/correos-spain/statuses.json) – Prerregistrado, oficina de cambio, tramitación aduanera, Intento de entrega. Ausente, Finalizado plazo retirada
- [GLS: Preguntas frecuentes para recibir paquetes](https://gls-group.com/ES/es/faq/recibir-paquetes/) – estados, plazos, horario, intentos, 7 días, Parcel Shop
- [SEUR: Ayuda](https://www.seur.com/miseur/ayuda) – En tránsito, 48 horas, Pickup, 7 y 5 días, Predict, QR o PIN, entregado a otra persona, devoluciones
- [Universal Parcel Scraper: estados de SEUR](https://github.com/plhery/universal-parcel-scraper/blob/main/carriers/seur/statuses.json) – textos en mayúsculas, ausencia, retraso, entregado a un vecino
- [InPost: Atención al cliente, contacto y ayuda](https://inpost.es/contacta-con-nosotros) – 3 días laborables, 5 días naturales, avisos, documentos, ausencia
- [UPS: Descripción del estado de seguimiento](https://www.ups.com/es/es/support/tracking-support/where-is-my-package/understanding-tracking-status) – trayectos largos, horario de reparto, lugar seguro y foto, Excepción
- [FedEx: Package not moving](https://www.fedex.com/en-us/customer-support/faqs/receiving/tracking-questions/package-not-moving.html) – 24 horas sin escaneos
- [DHL: International shipment status](https://www.dhl.de/en/privatkunden/hilfe-kundenservice/themen/international/sendungsverfolgung/was-bedeutet-mein-sendungsstatus.html) – contenedores, aduana, seguimiento del transportista de destino
:::
