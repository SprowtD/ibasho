# Open-source models and GPU clouds (2026-11-18)

Models anyone can download and run on a rented GPU (or their own), and the clouds Ibasho can rent GPUs from.
★ = Suggested. **US: permission needed** = the licence needs the maker's permission in the United States (for the model and what it makes). Ibasho never blocks it: it links to the licence page to apply, and once you have permission you switch on "I have permission".

## Pictures

- ★ **Anima (Turbo / Aesthetic / Base)**: best anime.
- ★ **Animagine XL 4.0**: safest anime licence.
- ★ **FLUX.2 klein 4B**: best Apache all-rounder.

| Model | GPU memory | Commercial use | Where | ComfyUI | Note |
| --- | --- | --- | --- | --- | --- |
| ★ Anima (Turbo / Aesthetic / Base) `circlestone-labs/Anima` | 8 GB (min 6) | with limits (CircleStone Non-Commercial + NVIDIA Open Model Licence) | everywhere | native | Anime-focused, ~2B on Cosmos-Predict2. Pictures you make may be sold; paid hosting of the model needs a licence. Turbo: 8–12 steps. VRAM figure is an estimate (GGUF 1–2.2 GB). |
| ★ Animagine XL 4.0 `cagliostrolab/animagine-xl-4.0` | 8 GB (min 6) | yes (OpenRAIL++-M) | everywhere | native | SDXL anime model; the clearest commercial licence of the anime models. |
| ★ FLUX.2 klein 4B `black-forest-labs/FLUX.2-klein-4B` | 16 GB (min 13) | yes (Apache 2.0) | everywhere | native | The 9B version is non-commercial. |
| NoobAI-XL 1.1 `Laxhar/noobai-XL-1.1` | 8 GB (min 6) | with limits (Fair AI Public 1.0-SD) | everywhere | native | Illustrious-based anime SDXL; closed, monetised derivatives banned. |
| Illustrious XL 1.0 `OnomaAIResearch/Illustrious-XL-v1.0` | 8 GB (min 6) | with limits (Illustrious licence (sources conflict)) | everywhere | native | Base of many anime SDXL models. |
| Z-Image-Turbo `Tongyi-MAI/Z-Image-Turbo` | 16 GB (min 8) | yes (Apache 2.0) | everywhere | native | 6B, 8 steps, fast. |
| FLUX 3 Image Klein `black-forest-labs/flux-3-image-klein` | 24 GB (min 8) | with limits (BFL licence, free under $5M yearly revenue (text unconfirmed)) | everywhere | INT8 | Gated on Hugging Face. Up to 10 reference pictures. ~4 s a megapixel on an RTX 5090. |
| Qwen-Image-2512 `Qwen/Qwen-Image-2512` | 24 GB (min 12) | yes (Apache 2.0) | everywhere | native | Strong at text inside pictures. |
| Qwen-Image-2.1 `Qwen/Qwen-Image-2.1` | 24 GB | no (Qwen Research Licence) | everywhere | unconfirmed | Up to 10 references. Likely non-commercial; VRAM unconfirmed. |
| HunyuanImage 3.0 `tencent/HunyuanImage-3.0` | 320 GB (min 160) | with limits (Tencent Hunyuan licence) | **permission needed in** EU, UK, KR ([apply](https://huggingface.co/tencent/HunyuanImage-3.0/blob/main/LICENSE)) | unconfirmed | 80B mixture of experts: several large GPUs. |
| MiniMax H3 Image `MiniMaxAI/MiniMax-H3-Image` | 80 GB (min 24) | with limits (MiniMax H3 licence) | **permission needed in** US, EU, UK, KR ([apply](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/QA-about-License.md)) | native | Needs MiniMax's permission in the US (apply through the licence page). ~56 s a picture at INT8 on an RTX 3090. |

## Picture editing

- ★ **Qwen-Image-Edit-2511**: best open editing.

| Model | GPU memory | Commercial use | Where | ComfyUI | Note |
| --- | --- | --- | --- | --- | --- |
| ★ Qwen-Image-Edit-2511 `Qwen/Qwen-Image-Edit-2511` | 24 GB (min 12) | yes (Apache 2.0) | everywhere | native | Edit a picture by instruction; FP8 ~20 GB, GGUF Q4 ~12 GB. |

## Video

- ★ **Wan 2.2 image-to-video 14B**: best open video.
- ★ **LTX-2.5**: video with sound.

| Model | GPU memory | Commercial use | Where | ComfyUI | Note |
| --- | --- | --- | --- | --- | --- |
| ★ Wan 2.2 image-to-video 14B `Wan-AI/Wan2.2-I2V-A14B` | 48 GB (min 24) | yes (Apache 2.0) | everywhere | native | Also T2V-A14B, TI2V-5B (fits 24 GB) and Animate-2-14B. Wan 2.5 and 3.0 are API-only (no weights). |
| ★ LTX-2.5 `Lightricks/LTX-2.5` | 48 GB (min 16) | with limits (LTX-2.x Community Licence (revenue threshold, reported $10M)) | everywhere | native | Makes picture and sound together; fast. Gated, approved automatically. |
| HunyuanVideo 1.5 `tencent/HunyuanVideo-1.5` | 24 GB (min 14) | with limits (Tencent Hunyuan licence) | **permission needed in** EU, UK, KR ([apply](https://huggingface.co/tencent/HunyuanVideo-1.5/blob/main/LICENSE)) | native | Separate licence above 100M monthly users. |
| Mochi 1 `genmo/mochi-1-preview` | 24 GB | yes (Apache 2.0) | everywhere | native | Older; low priority. |
| MiniMax H3 (and FL2VA, Ref2VA, FastH3) `MiniMaxAI/MiniMax-H3` | 141 GB (min 80) | with limits (MiniMax H3 licence) | **permission needed in** US, EU, UK, KR ([apply](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/QA-about-License.md)) | native | Weights and outputs need MiniMax's permission in the US, EU, UK and South Korea (they say the limit is temporary); apply through the licence page. |

## Voices

- ★ **Style-Bert-VITS2 JP-Extra**: Japanese anime voices.
- ★ **Qwen3-TTS 1.7B (and 0.6B, VoiceDesign)**: best open voice.

| Model | GPU memory | Commercial use | Where | ComfyUI | Japanese | Note |
| --- | --- | --- | --- | --- | --- | --- |
| ★ Style-Bert-VITS2 JP-Extra `litagin02 (exact repo unconfirmed)` | CPU is enough | with limits (AGPL code (weights vary)) | everywhere | no | yes | Japanese-native with strong emotion control; runs on a CPU, so no GPU rental needed. |
| ★ Qwen3-TTS 1.7B (and 0.6B, VoiceDesign) `Qwen/Qwen3-TTS-12Hz-1.7B-Base` | 8 GB (min 4) | yes (Apache 2.0) | everywhere | community | yes | Clones a voice from ~3 s of audio; voice design from a description. |
| Kokoro-82M `hexgrad/Kokoro-82M` | CPU is enough | yes (Apache 2.0) | everywhere | community | no | Tiny and fast, runs on a CPU; weak Japanese. |
| Chatterbox Multilingual V3 `ResembleAI/chatterbox` | 6 GB (min 4) | yes (MIT) | everywhere | community | yes | Small (0.5B), voice cloning. |

## Music

- ★ **ACE-Step 1.5 (+ XL)**: best open music.

| Model | GPU memory | Commercial use | Where | ComfyUI | Note |
| --- | --- | --- | --- | --- | --- |
| ★ ACE-Step 1.5 (+ XL) `ACE-Step (exact repo unconfirmed)` | 8 GB (min 4) | yes (MIT) | everywhere | native | Under 10 s a song on an RTX 3090. |
| MiniMax Music 3 `MiniMaxAI/MiniMax-Music3` | 24 GB (min 8) | with limits (Reports conflict (MiniMax Community vs CC-BY-NC)) | everywhere | unconfirmed | No territory limit this time. |

## Sound effects

- ★ **Stable Audio Open 1.0**: best open sound effects.

| Model | GPU memory | Commercial use | Where | ComfyUI | Note |
| --- | --- | --- | --- | --- | --- |
| ★ Stable Audio Open 1.0 `stabilityai/stable-audio-open-1.0` | 8 GB | with limits (Stability community licence, free under $1M revenue) | everywhere | native | Sound effects and short music. |
| MMAudio (sound for a video) `hkchengrex/MMAudio` | 8 GB (min 6) | no (Code MIT; weights reportedly CC-BY-NC) | everywhere | community | Watches a clip and makes matching foley. |
| HunyuanVideo-Foley `tencent/HunyuanVideo-Foley` | 24 GB | with limits (Tencent Hunyuan licence) | **permission needed in** EU, UK, KR ([apply](https://huggingface.co/tencent/HunyuanVideo-Foley/blob/main/LICENSE)) | community | Foley for a video; VRAM unconfirmed. |

## Writing (chat and reasoning)

- ★ **Gemma 4 31B**: best open writer on one GPU.

| Model | GPU memory | Commercial use | Where | ComfyUI | Note |
| --- | --- | --- | --- | --- | --- |
| ★ Gemma 4 31B `google/gemma-4-31b-it` | 80 GB (min 24) | yes (Gemma licence (sources conflict)) | everywhere | no | ~18 GB at Q4. |
| Qwen 3.6 27B `Qwen (exact repo unconfirmed)` | 24 GB | yes (Apache 2.0 (unconfirmed)) | everywhere | no | ~38 tokens/s on an RTX 4090 at Q5. |
| gpt-oss-120b `openai/gpt-oss-120b` | 80 GB | yes (Apache 2.0) | everywhere | no | One 80 GB card (MXFP4). |
| Kimi K3.1 Pro / GLM-5.3 / DeepSeek V4.1 `moonshotai (and zai-org, deepseek-ai)` | 1100 GB (min 510) | yes (Modified MIT / MIT) | everywhere | no | Need an 8-GPU node: use them through OpenRouter instead (much cheaper). |

## Upscaling

- ★ **Real-ESRGAN anime 6B**: anime picture upscaler.
- ★ **SeedVR2 3B / 7B**: best open video upscaler.

| Model | GPU memory | Commercial use | Where | ComfyUI | Note |
| --- | --- | --- | --- | --- | --- |
| ★ Real-ESRGAN anime 6B `xinntao/Real-ESRGAN` | 4 GB (min 2) | yes (BSD) | everywhere | native | Small and fast. |
| ★ SeedVR2 3B / 7B `ByteDance-Seed/SeedVR2-3B` | 24 GB (min 18) | yes (Apache 2.0) | everywhere | native | Block-swap lowers memory. |

## Frame interpolation

| Model | GPU memory | Commercial use | Where | ComfyUI | Note |
| --- | --- | --- | --- | --- | --- |
| RIFE frame interpolation `hzwer/Practical-RIFE` | 4 GB (min 2) | yes (MIT) | everywhere | community | In ComfyUI-Frame-Interpolation, with FILM (Apache). |

## GPU clouds

Starting prices in $ an hour for one GPU (live prices replace these where the cloud has a price API).

| Cloud | RTX 4090 | RTX 5090 | L40S | A100 80GB | H100 | H200 | B200 | Billing | Live prices | First wave |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RunPod (pods) | $0.34 | $0.69 | $0.79 | $1.19 | $1.99 | $3.59 | $5.98 | per second | yes | yes |
| RunPod (serverless) | $1.34 | $1.89 | $1.89 | $2.99 | $5.89 | $6.99 | $10.79 | per second | yes | yes |
| Vast.ai (marketplace) | $0.49 | $0.50 | $0.80 | $0.73 | $2.54 | $4.30 | $6.70 | per second, no minimum | yes | yes |
| Lambda | – | – | – | $3.19 | $3.79 | – | $7.69 | by the minute (unconfirmed) | yes | yes |
| Modal (serverless) | – | – | $1.95 | $2.50 | $3.95 | $4.54 | $6.25 | per second; loading and idle billed; $30 free a month | no | yes |
| Salad (consumer GPUs) | $0.30 | $0.45 | – | – | – | – | – | per second | stock only | later |
| Thunder Compute | – | – | – | $1.09 | $3.20 | – | – | per minute | stock only | later |
| Novita | $0.33 | – | – | – | $3.39 | – | – | unconfirmed | no | later |
| Koyeb (serverless) | – | – | $1.20 | $1.60 | $2.50 | $3.00 | $5.50 | per second, scales to zero; needs the $29/month Pro plan | no | later |

GPU memory and rough speed (RTX 4090 = 1): RTX 4090 24 GB ×1.0, RTX 5090 32 GB ×1.4, L40S 48 GB ×0.9, A100 80GB 80 GB ×1.0, H100 80 GB ×2.0, H200 141 GB ×2.2, B200 180 GB ×3.2.

## How Ibasho picks a GPU

- **Fits:** keep GPUs with vram >= the model's need x 1.15; drop out-of-stock offers and models the person's region forbids.
- **Time:** seconds = base_seconds_on_4090 / speed + startup_s.
- **Cheapest:** lowest total cost of the job (not the lowest hourly price).
- **Fastest:** shortest time.
- **Default:** the fastest choice costing no more than 1.5x the cheapest (studio rule: +$1-2/h is fine if it halves the time).
- The estimate is shown before anything starts, and the machine is always stopped after.

Examples with today's starting prices (`core/gpu_route.mjs`):

- One Anima picture (8 GB, ~6 s on a 4090): RunPod serverless RTX 5090, ~34 s with start-up, about $0.02.
- One Wan 2.2 14B clip (48 GB, ~10 min on a 4090): cheapest = Vast.ai A100, 15 min, $0.18; default = H100, 6 min, $0.25 (60% quicker for 37% more); fastest = B200, 3.6 min, $0.65.
- 50 Wan clips in a row: default = RunPod H100 pod, ~4.2 h, about $8.40 (half the time of the cheapest for 37% more).
