# MUDD Production Performance Benchmark

**Measured window:** 2026-10-31 16:06:26–16:08:13 UTC  
**Deployment build:** `cf9a1ee8-2155-47dc-91dd-0016baab2d92` (successful build created 12:38 UTC; warm for over three hours)  
**Method:** one production guest, one client, serial requests with about one second between samples; no load testing. Timings are from the benchmark runner in Replit’s execution environment, not a mobile browser.

## Summary

This was a **partial benchmark**. It completed 30 snapshots, 30 room-description queries, and 26 successful moves. The next move returned HTTP 200 with a `RULE_VIOLATION` receipt; its response message was not retained, so the cause is unconfirmed (stamina exhaustion is plausible after the 26 moves). The run stopped there: no heartbeat or rename samples were taken. The world session close returned HTTP 204. No app code, configuration, database schema, or deployment was changed.

Before world entry, one `GET /api/game` returned the expected 409 to clear a cached negative session lookup. The first setup attempt had created the session but the first snapshot still returned 409. Code inspection indicates a likely stale prefetched-session cache entry; the benchmark worked around it, but did not fix it.

## Client-side request latency

Nearest-rank p95. These are elapsed HTTP request times from the benchmark runner.

| Operation | Samples | Median | p95 | Range |
|---|---:|---:|---:|---:|
| GET /api/game snapshot | 30 | 186.7 ms | 216.8 ms | 149.9 ms–281.1 ms |
| POST /api/queries location.describe | 30 | 187.4 ms | 286.7 ms | 152.9 ms–313.2 ms |
| Successful character moves | 26 | 270.0 ms | 312.0 ms | 242.4 ms–419.7 ms |
| World-session heartbeat | 0 | — | — | Not run |
| Character rename | 0 | — | — | Not run |

## Comparison with the prior October 31 benchmark

The previous run (11:30–11:38 UTC, build `9acab6da-d56a-4f1f-a258-91632ac36fa8`) measured the same three request classes serially. This run is much faster, but it is not a controlled A/B test: the deployment build and time window differ, and the new movement sample includes only successful moves (no retries). Treat the change as an observed production improvement, not proof of a single code change’s effect.

| Operation | Earlier median / p95 | New median / p95 | Observed median change |
|---|---:|---:|---:|
| Snapshot | 2,627.9 / 3,497 ms | 186.7 ms / 216.8 ms | −92.9% |
| location.describe | 2,241.5 / 3,480.2 ms | 187.4 ms / 286.7 ms | −91.6% |
| Move request | 2,540.4 / 4,269.8 ms | 270.0 ms / 312.0 ms | −89.4% |

## Server trace findings

The server trace review matched all 30 successful snapshots and 26 successful moves. Response `Server-Timing` headers were absent; timings below come from deployment traces.

- **Snapshots:** average server duration 145.9 ms (139–157 ms; p95 155 ms); average 5.03 queries and 220.5 ms summed query time; pool wait averaged 3.10 ms (max 7.40 ms). Largest measured projection stages were NPC positions (112.7 ms average) and location projection (113.8 ms); room occupants averaged 30.3 ms.
- **Moves:** average server duration 236.2 ms (229–252 ms); average 13.04 queries and 425.4 ms summed query time; pool wait averaged 6.17 ms (max 9.00 ms). Command averaged 58.1 ms, command guard reads 27.8 ms, and movement projection 118.4 ms, mostly NPC positions (115.0 ms).
- **location.describe:** endpoint telemetry for 30 requests reports 181.9 ms average and 312.5 ms p95; per-request stage and query details were unavailable for this route.
- Summed query time can exceed request duration because some queries overlap. Pool wait was low in these samples, so connection-pool queueing was not the leading measured cost.
- Proxy aggregate counters did not reconcile with request-level traces; use the sampled traces for this run rather than treating the proxy bucket as a complete request count.

## Findings and next focus

The biggest measured remaining work in snapshot and movement projections is NPC-position resolution, followed by location projection. If continuing performance work, profile and reduce that path first, then look at the repeated stream-head and revision queries. Pool sizing is not the first optimization indicated by these traces.

The setup behavior also suggests a separate correctness issue: character creation can cache a negative prefetched world-session result; successful world entry invalidates the world-session cache, but appears not to clear that prefetched result for the same identity. The next snapshot may then return 409 until that cached miss is consumed. This was not changed in this benchmark.

## Scope and cleanup

Three guest/character identities were created across the attempts needed to complete this partial run. No guest records were manually deleted. World-session close was attempted for the earlier attempts but their statuses were not captured; the final run’s close was confirmed HTTP 204. Normal guest cleanup is expected to remove the test records. No 5xx was observed in the trace review. No test suite was run because no code changed.

## Setup request IDs

| Operation | HTTP | Client time | Request ID |
|---|---:|---:|---|
| guest-session | 200 | 221.2 ms | eb7163bc-0e3e-48f3-8854-e54c52e9c000 |
| character-create | 200 | 382.2 ms | 15946e37-3b9a-4ffb-9938-e42ceabaef7d |
| pre-entry-cache-prime | 409 | 11.8 ms | 00ffce6c-a512-4919-873f-d90fce8296c2 |
| world-entry | 200 | 375.5 ms | 19d0c25c-ee6b-4c67-98a7-2fa23bff109c |
| warmup-snapshot | 200 | 400.4 ms | a50a630a-cdaa-43a9-9d31-eaa634c3e72f |
| warmup-location.describe | 200 | 225.7 ms | 86aed496-9eb4-4673-ae01-4cf57388063d |

## Snapshot request ID / trace ID pairs

```text
9a7cca7d-f8ba-405a-a55f-b4804c237b44=7573d34a-1fe7-4e44-927c-ee64b41bcdeb
0246ac28-a740-49c9-a563-4f174c92165b=6a0d851b-37c5-4024-bcb2-3c61676ea26a
72c1b86d-0f1d-4499-81b9-dfd029f5d3ab=94fadeb0-7b34-48e3-aa96-391686bf4f8d
547c5158-d780-4ca9-9271-2b56f6982bf0=b003bfa4-d575-4fd0-8018-505282897a7d
6e726b20-0523-40ac-a2c6-f1ec103745b0=02ab2c41-0fc4-47ca-bf52-43909629e725
d4638c16-e8c0-4745-93cd-11d45d014b2a=21f0cb84-c95f-4a81-bb4a-e0b2aac79faa
421da7e6-0fe2-434e-8071-e092a5573b11=f4b7f86a-5388-4f9e-b72a-5775a7def8de
b25d12ff-3d17-4271-b9a8-ccc4c97c79b6=488e42f3-fc85-4bb4-894e-975d4f79819c
487fcfb6-27eb-41f3-a6f7-1b83e88f4b38=e7455fd0-7e8f-4035-b5df-b1fe38b79a58
84e001c2-3e7f-44ec-9faf-f9670b1b853b=b67cf42a-a7ce-4693-8840-80ec7e451f9d
a9a5a885-20ad-447f-a2e6-d4ac3a345040=a5f42470-e7ce-4761-9190-8b90694219bd
a8a0756c-b445-438e-912b-f764600b200b=540e31fd-899d-451a-b30d-1bcff913de48
a2ee4d2f-ae23-42dc-a176-bd8a3b826d39=ca2388fd-d104-4aed-8252-0a26b7324ad4
9892bc84-c100-46ea-b638-f56f1be6e86f=f9d44a9e-7447-438b-97be-a6cbd3859c9b
517c9cb1-dcee-442f-a9aa-8fd26617156f=9983fabc-1e5a-4356-a7cf-fcf777f75873
f779332d-0065-404b-a0e8-58dbe8c77aff=a47f64ac-7bb8-497e-aeab-702d9a9ea9f6
20041091-b527-4782-a50b-8b1cf58b3417=cad0386e-574b-44aa-b89a-ff77c99743bb
0d4ffa11-55aa-4acc-8d8a-5f399a7db9fa=1020ecab-a928-497b-b280-d3192d305ce5
ddb84f0e-5f0b-43e4-843f-2fd6f2b295c7=a058b837-170b-48dd-9bff-342da91696eb
40b9c48e-7c83-45a4-a208-fefb372aa416=868e96ff-b549-4639-a475-f710174ef914
92a8270c-ef7f-4265-97db-93288e8f0d14=69816dd2-591c-470c-bc7c-3dbd41ecca1f
8e11c732-a3a3-4334-b0c6-28787823a9c5=d75c5b37-b8bc-431a-b363-7d3932b48c15
d506ce5a-61d5-4ba8-822d-2db27153951c=0cbbf28b-5c2f-4137-8286-b5d14e5c1688
ad826699-5b7c-4cc4-a12b-7275f1f75b25=c232ad53-4b86-410f-a94b-07121ba82bd4
553710e8-0e03-4467-a238-113df973e46d=322b241e-255c-43ea-8931-c5fcba0044de
9a5730c3-5e4f-46a7-9447-10c4ae586203=0c7440ff-5866-4e4f-9db6-a028c6e90587
4b8cee6d-5b63-4180-9232-c2a0c853f162=126aade2-b928-4bca-9592-537b40f6a619
2e0b3774-eb0a-482f-9622-a1f0b568ade9=87b95fcb-ed95-4d1f-8b87-64864ccd6442
de544766-53fc-441c-9750-b3f83b0bd4db=4e1b2e01-e906-463e-8ed6-957acb39abaa
fa0a48c7-2d40-46cd-b01c-2e0d61af7391=29e3c8a6-c776-4fd3-bf92-222fd1490237
```

## Successful move request ID / trace ID pairs

```text
12fe9229-dd81-45a8-b620-ef2981c1dc90=fa218a28-b95c-4e9c-a0a9-62715aa32299
346817ac-8d07-415e-ba76-fb79d468af7e=7a46562f-8e37-4e33-86c5-a7809dec43c4
22e94a9c-1aa3-47ad-826a-634c84174d80=07cb8cd1-7907-4174-8f50-cd8f3c4cdcd6
8962aae5-4294-42ee-b4eb-7b2753694559=e43d3a1c-4869-4ff1-a547-928d9916d45c
8548f760-cdaf-40a7-97b3-2b15e739b8aa=e8cf840d-b83b-4d82-9c84-856a9820d1d9
305c814e-848a-45f7-9a4b-917d1981be03=f969d64f-10c5-4c33-bdde-496fc527ed62
f6627122-b37a-433c-947f-32db37dde626=1a6b575f-6e39-4e99-9a44-e6e735ec88e5
d4910156-4b8d-412e-965f-09ec6d615844=e04143c2-e992-4f8e-9848-4c002b20dd3a
a26d196d-6f21-41a0-949e-a4a299c6120e=2b1ea7f4-d24e-4276-9c3a-efb132a6f3a5
87d89962-5738-415e-847d-7830102461dd=4138e6ac-0d1c-4c93-b2a7-c9607be12a96
4f63e955-7884-4dbb-8472-7e1d2b670c21=5f935c78-b977-4934-bef9-861992e8b940
eba35412-232a-469e-b907-2a9588984bae=fa81ddb4-0fd3-43e3-8ba8-4e965ac3a873
8f49d422-472b-49fe-a85a-e85ab779b258=0fa55587-240f-4f9b-9a00-8d15926cf953
72ecc00c-a908-49e5-8611-6af8227d3355=652f1403-de48-4592-9586-3498e02eddc4
79f46a2c-117d-4c20-b161-b435ccece207=433af882-27d5-465d-bc13-5a3ef899d785
d36f8793-5528-4f87-814f-60fc4ad2b5e7=13ff0a3a-05e8-488d-8da3-113914adeb77
3212fecd-acd0-4b66-b376-07a440376146=dc255af0-5383-4a94-b137-e9d4c357c461
d270f7c9-0272-49c9-8856-bd0ec39cc8a3=bebba8ec-a536-49c2-ae6a-c8d575e71289
8f98944b-3f2b-4506-b929-785f31b343dd=794cb113-1f63-45d3-8203-f7b99d38020f
5d4c1d56-6122-461b-93f6-fe5ff97b4f38=200b3cfb-328e-4db2-9dd0-bffb62422da0
b1a0c96d-1604-4e42-8ec4-055f9e0cb6f7=14c3d539-f9a3-4263-8f05-e9db9472e4cd
b0c8fd0b-63df-484e-9340-6012038532fb=2267e1b7-a0e0-4f87-b9ea-994275d8618d
2b7c6e43-e76a-46c5-9102-0ca3498e0b94=4b289256-52cb-4ff5-a13d-9a7f876778a3
aa0309cc-484c-433e-9229-0d003228195c=33302320-5f53-42e1-bf9e-ee7b74f0c8ca
3660ceff-382e-42b7-85f4-76d5c436c19c=842044f6-14c5-48b0-a042-149a0de7c8ea
58a6d399-cf2b-40a9-bd7f-6b2fe91bb1f1=f002c082-2ae4-49f7-919b-52f56bcbbb47
```

## location.describe request IDs

```text
57a4dcee-3632-48cc-a98d-3c9b9206421d
e155e477-498f-4740-af45-d0ec501a8304
d22b4d3c-6ef9-43a2-91ed-4cf65a6983c7
81d0673a-b1dc-49f5-b439-8ac8b5c8f974
36aa2a6c-dce6-4bee-8491-ad6535075794
6743274d-d119-4a7a-bc02-be373e54546b
e08431fa-b659-44ac-9a08-820c7e4bb926
76935432-83fe-43f7-acbe-623440cd3e3b
8450d29c-e277-4c6d-9976-3f97af9824ab
0c32eabe-dc60-4209-9469-24684822f4f4
64323b76-40da-4e16-bc52-1ea9d14753e2
911dd6f3-4737-4c23-abc7-1988609d3e08
e0d9687a-48e3-498f-9207-7c4140e9bd1c
2c515258-9555-431c-aca9-59a001a38122
e396f0be-16ba-42f4-ad0f-0095fe66bee9
e19caf24-71b2-44e9-9aed-c167203d1976
afdf7cc5-95ca-4210-abd3-6114736b32d7
bb37892a-c8c5-4da2-9646-5caa70806cfd
913b3070-5004-4b97-a6f9-ac833a5a6699
bd51768c-741e-4c5e-b3cf-7bed918d3f6a
79029286-7cc2-426f-8da2-7ca63ebb90c6
f94886f2-345c-49f4-837e-e7221234d25f
862ed05e-966a-4d23-803b-f8a36240d4aa
336a57fe-bce7-42b2-b1ce-d7b6d0570a25
a443af56-63b6-4a74-897f-dd44d1dbf486
404562b1-211b-4e88-9b4f-94dfa6061a13
925b15cc-ba6d-4487-b194-83f0114fe183
f4dd7164-3181-49c3-9033-164bde5c40a8
501fdba4-1016-45c8-ac61-5a43f738ba17
b85636aa-0297-460b-ba33-bffbb5cd6438
```
