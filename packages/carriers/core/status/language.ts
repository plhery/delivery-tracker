import type { Stage } from '../../generated/catalog';
import type { CarrierStatus } from '../result';

/**
 * INFERRED language rules, not captured carrier codes. EN/FR/DE/IT/ES/PT/PL equivalents
 * are intuitive and overridable: an adapter must resolve verified codes and
 * carrier-specific semantics before consulting this fallback. No fixture import.
 */
export function trackingLanguageStage(description: string): Stage | undefined {
  const text = description.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[’‘]/g, "'").replace(/ł/g, 'l').replace(/[_–—-]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');

  if (/^wird zugestellt$/.test(text)) return 'out_for_delivery';

  // Specific negatives, future steps and handoffs precede broad delivery words.
  if (/return(?:ed|ing)? to (?:the )?sender|retour(?:ne)? a l'expediteur|zuruck an (?:den )?absender|an (?:den )?absender zuruck|retour a l'expediteur|reso al mittente|restituit[oa] al mittente/.test(text)) return 'returned';
  if (/not (?:yet )?delivered|could not.*deliver|unable to deliver|delivery (?:attempt|failed)|non livre|n'a pas pu.*remis|livraison (?:impossible|echouee)|tentative de livraison|nicht zugestellt|nicht zugestellt werden|zustellung.*(?:fehlgeschlagen|nicht moglich)|zustellversuch|non consegnat[oa]|non e stato possibile consegnare|consegna (?:fallita|non riuscita)|tentativo di consegna/.test(text)) return 'failed_attempt';

  // Carrier-reported problems that are neither a missed attempt nor a return.
  if (/\b(?:damaged|broken in transit)\b|endommag|avarie|deterior|beschadigt|danneggiat|danad[oa]|danificad|uszkodzon/.test(text)) return 'exception';
  if (/\blost (?:in transit|package|parcel|shipment)?\b|colis perdu|envoi perdu|egare|verloren|verlust der sendung|smarrit|(?:paquete|envio) perdid|extraviad|zagubion|zaginion/.test(text)) return 'exception';
  if (/refused by (?:the )?(?:recipient|consignee)|\brefused\b|rejected by (?:the )?recipient|refus(?:e|ee)? par le destinataire|refus du destinataire|(?:colis|envoi|pli) refuse|annahme verweigert|verweigert|rifiutat|rechazad|recusad|odmowa przyjecia|odmowiono przyjecia/.test(text)) return 'exception';
  if (/address (?:incomplete|incorrect|invalid|insufficient|unknown)|(?:incorrect|incomplete|insufficient|wrong|invalid) address|address(?:ee)? (?:unknown|cannot be located)|recipient unknown|adresse (?:incorrecte|incomplete|erronee|invalide|inconnue)|destinataire inconnu|(?:adresse|anschrift) (?:unvollstandig|falsch|unbekannt)|empfanger unbekannt|indirizzo (?:errato|incompleto|insufficiente|sconosciuto)|destinatario sconosciuto|direccion (?:incorrecta|incompleta|erronea|desconocida)|destinatario desconocido|endereco (?:incorreto|incompleto|errado|desconhecido)|destinatario desconhecido|adres (?:niepelny|nieprawidlowy|bledny)|nieznany adresat/.test(text)) return 'exception';
  if (/customs (?:issue|problem|hold)|held (?:by|in|at) customs|detained by customs|probleme de douane|retenu en douane|zollproblem|vom zoll zuruckgehalten|problema doganale|fermo in dogana|problema de aduana|retenido en aduana|problema (?:alfandegario|na alfandega)|retido na alfandega|problem celny|zatrzyman[ay] przez (?:urzad celny|cel)/.test(text)) return 'exception';
  if (/(?:shipment|parcel|package) (?:is )?(?:held|blocked|on hold)|held pending|awaiting (?:your )?instructions|action required|(?:colis|envoi|pli) (?:bloque|retenu)|en attente d'instructions|action requise|sendung (?:blockiert|zuruckgehalten|angehalten)|wartet auf anweisungen|handlung erforderlich|spedizione (?:bloccata|trattenuta)|in attesa di istruzioni|envio (?:bloqueado|retenido)|en espera de instrucciones|accion requerida|encomenda (?:bloqueada|retida)|aguarda instrucoes|acao necessaria|przesylka (?:zatrzymana|wstrzymana)|oczekuje na instrukcje/.test(text)) return 'exception';
  if (/\bincident\b|\banomal(?:y|ie|ia)\b|delivery exception|shipment exception|irregularit|unregelmassigkeit|storung|vorfall|inconveniente|incidencia|nieprawidlowosc/.test(text)) return 'exception';

  if (/delivered to (?:the )?(?:local carrier|delivery partner)|livre au transporteur|remis au transporteur local|an den lokalen zusteller ubergeben|consegnat[oa] al corriere locale/.test(text)) return 'in_transit';
  if (/will (?:shortly |soon )?be handed|bientot.*(?:confie|remis)|prochainement.*remis|wird.*(?:kurze|bald).*ubergeben|sara.*(?:breve|presto).*affidat/.test(text)) return 'registered';
  if (/or awaiting processing|ou en attente de traitement|oder wartet auf.*bearbeitung|o in attesa di elaborazione/.test(text)) return 'registered';
  if (/will be transported|sera (?:transporte|achemine)|wird.*transportiert|sara trasportat/.test(text)) return 'in_transit';
  if (/will be available|sera disponible|wird.*verfugbar|sara disponibile|to be delivered|a livrer|noch zuzustellen|da consegnare/.test(text)) return 'in_transit';

  if (/will be delivered|sera livre|wird.*zugestellt|sara consegnat/.test(text)) return 'registered';

  if (/ready for (?:pickup|collection)|ready to collect|available for (?:pickup|collection)|pret.*(?:retrait|retire)|disponible.*(?:retrait|collecte)|abholbereit|zur abholung bereit|pront[oa] per il ritiro|disponibile per il ritiro|(?:deposited|depose|hinterlegt|depositat[oa]).*mypost24/.test(text)) return 'ready_for_pickup';

  // Pre-advice can contain "data delivered", a recipient or a carrier handoff.
  if (/label (?:created|printed)|created a label|etiquette.*(?:cree|imprime)|cree une etiquette|versandetikett.*(?:erstellt|gedruckt)|etikett erstellt|etichetta.*(?:creata|stampata)|creato un'etichetta|elektronisch|electroni(?:c|que|sch)|elettronic|pre.?advi[cs]|preannunciat|vorangemeldet|preannonce|data.*entered|donnees.*saisies|daten.*erfasst|dati.*inseriti/.test(text)) return 'registered';
  if (/shipment information received|informations d'expedition recues|sendungsinformationen erhalten|informazioni.*spedizione ricevute|consignment recorded by|envoi enregistre par|sendung.*absender.*erfasst|spedizione registrata dal/.test(text)) return 'registered';
  if (/preparation chez.*expediteur|preparation.*expediteur|preparazione.*mittente|being prepared.*sender|beim absender.*vorbereitet|warehouse of the sender|shippers warehouse|entrepot de l'expediteur|lager des absenders|magazzino del mittente|demande d'envoi.*prise en compte|collection request.*(?:received|recorded)|abholauftrag.*erfasst|richiesta.*ritiro.*registrata/.test(text)) return 'registered';
  if (/^(?:reported|recorded|announced|enregistre|annonce|erfasst|angekundigt|registrato|annunciato)$/.test(text)) return 'registered';

  // Completion/release is distinct from pending or explicitly negated clearance.
  if (/attend d'etre libere|attente de liberation|wartet auf.*freigabe|attesa di svincolo|(?:customs|clearance).*\bnot\b.*(?:clear|complet|releas)|dedouanement.*pas termine|customs (?:not cleared|clearance not completed)|not.*released by customs|dedouanement.*(?:non termine|pas termine)|non dedouane|zollabfertigung.*nicht abgeschlossen|nicht.*zoll.*freigegeben|sdoganamento.*non completato|non sdoganat/.test(text)) return 'customs';
  if (/clearance.*(?:has been completed|completed)|completion of customs|released by (?:customs|a government agency)|customs (?:cleared|released)|dedouanement.*(?:termine|acheve)|fin du dedouanement|libere.*(?:douane|autorite)|douane.*libere|zollabfertigung.*abgeschlossen|(?:zoll|behorde).*freigegeben|sdoganamento.*completato|completamento.*sdoganamento|svincolat.*(?:dogana|autorita)/.test(text)) return 'in_transit';
  if (/customs|clearance|douan|zoll|dogan|government agency|autorite gouvernementale|staatliche behorde|autorita governativa/.test(text)) return 'customs';

  if (/out for delivery|being delivered|in delivery|(?:loading|loaded).*delivery vehicle|en cours de livraison|en livraison|charg(?:e|ement).*vehicule de livraison|in zustellung|zustellfahrzeug.*(?:geladen|verladen)|(?:beladen|verladung).*zustellfahrzeug|in consegna|caric(?:at|amento).*veicolo.*consegna/.test(text)) return 'out_for_delivery';
  if (/\bdelivered\b|delivery completed|^(?:livre|livree)(?:$|[ ,])|(?:colis|envoi|est|a ete) livre|zugestellt|\bconsegnat[oa]\b|livraison effectuee|consegna completata/.test(text)) return 'delivered';

  // Posting/collection by the carrier, not recipient pickup or data submission.
  if (/accepted|picked up|pick up was successful|handed (?:over )?to (?:dpd|gls)|package received at dhl|item booked|consignment was mailed|posted at a postal point|pris en charge|prise en charge|collecte.*(?:reussi|effectue)|recupere.*boite aux lettres|depose.*point postal|remis a (?:dpd|gls)|envoi.*depose|abholung.*erfolgreich|eingeliefert|an (?:dpd|gls) ubergeben|paket.*(?:angenommen|ubernommen)|ritiro.*(?:riuscito|effettuato)|pres[oa] in carico|affidat[oa] a (?:dpd|gls)|depositat.*punto postale|spedizione.*impostata/.test(text)) return 'accepted';
  if (/transit|en route|on (?:its|the) way|acheminement|unterwegs|transport|trasport|arriv|depart|processed|processing completed|sorted|sorting|\btri\b|trie|traitement|traite|sortier|bearbeitet|bearbeitung|elaborat|elaborazion|smistat|parcel cent(?:er|re)|delivery cent(?:er|re)|centre.*(?:colis|distribution)|paketzentrum|verteilzentrum|centro.*(?:pacchi|distribuzione)|depot|import scan|scan.*import|importscan|scansione.*import|delivery.*delayed|livraison.*retard|zustellung.*verzogert|consegna.*ritard|transferred|transfere|weitergeleitet|inoltrato|left.*(?:point|center)|quitte|verlassen|raggiunto|close bag|fermeture du sac|sack.*geschlossen|chiusura.*sacco|scanned into|scanne dans|eingescannt|scansionat|loaded to movement|charg.*vehicule de transport|transportfahrzeug.*geladen|caric.*veicolo.*trasporto/.test(text)) return 'in_transit';
  return undefined;
}

export function languageStageStatus(stage: Stage): CarrierStatus {
  if (stage === 'registered' || stage === 'pending') return 'pending';
  if (stage === 'delivered') return 'delivered';
  if (stage === 'out_for_delivery' || stage === 'ready_for_pickup') return 'out_for_delivery';
  if (stage === 'returned' || stage === 'failed_attempt' || stage === 'exception') return 'exception';
  return 'in_transit';
}
