// The upstream carrier adapters moved into their carrier folders; this path
// stays for host code and the grouped tests that still import it.
export { fetchCainiao } from '@carriers/carriers/aliexpress/adapter';
export { fetchPlanzer, planzerShipmentNumber } from '@carriers/carriers/planzer/adapter';
export { fetchPostlogistics } from '@carriers/carriers/postlogistics/adapter';
export { fetchPostNL } from '@carriers/carriers/spring-gds/adapter';
export { fetchSunYou } from '@carriers/carriers/sunyou/adapter';
