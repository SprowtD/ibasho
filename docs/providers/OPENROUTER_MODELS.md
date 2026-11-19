# OpenRouter models for Ibasho (2026-11-18)

Made by `tools/openrouter_catalog.py` from OpenRouter's public lists. Prices are OpenRouter's (the maker's list price); +5.5% when you top up by card.

★ = Suggested: the best-performing or newest strong models in each category, from Artificial Analysis and Arena rankings (18 Nov 2026). Everything else sits under "More models".

## Chat and reasoning (scripts, ideas, running the flows)

Price per 1 million words-pieces (tokens) read / written. A chapter script is roughly 5,000–10,000 tokens.

**Suggested**

- ★ **Anthropic: Claude Fable 5.2** `anthropic/claude-fable-5.2` · best quality · $8 in / $40 out. #1 on the AA Intelligence Index (65) and Arena Agent.
- ★ **OpenAI: GPT-6.2 Astra** `openai/gpt-6.2-astra` · best quality · $8 in / $40 out. #2 on AA (62) at about 1/6 of Fable's cost per task.
- ★ **Google: Gemini 4 Carbon** `google/gemini-4-carbon` · best for writing · $2 in / $10 out. #1 on Arena Text (1526); #3 on AA (60).
- ★ **OpenAI: GPT-6.2 Sol** `openai/gpt-6.2-sol` · best value · $2 in / $10 out. AA 57 at about $1 a task.
- ★ **Google: Gemini 3.8 Flash** `google/gemini-3.8-flash` · best value · $0.82 in / $4.12 out. #9 on Arena Text (1497); cheap and fast.
- ★ **MoonshotAI: Kimi K3.1 Pro** `moonshotai/kimi-k3.1-pro` · best open · $0.24 in / $8.4 out. top open-weight model on AA (46).
- ★ **DeepSeek: DeepSeek V4.1 Flash** `deepseek/deepseek-v4.1-flash` · cheapest good · $0.05 in / $0.2 out. AA 33 at $0.60 a task, the cheapest that holds up.

### Top: the hardest work

| Model | In | Out | Reads pictures | Why |
| --- | --- | --- | --- | --- |
| ★ Anthropic: Claude Fable 5.2 `anthropic/claude-fable-5.2` | $8 | $40 | yes | Anthropic's most capable model; best for whole flows and long scripts |
| ★ OpenAI: GPT-6.2 Astra `openai/gpt-6.2-astra` | $8 | $40 | yes | OpenAI's flagship |
| Google: Gemini 4 Argon `google/gemini-4-argon` | $2 | $10 | yes | Google's flagship reasoning model |
| ★ Google: Gemini 4 Carbon `google/gemini-4-carbon` | $2 | $10 | yes | Google frontier model; #1 for writing and chat on Arena |
| Anthropic: Claude Opus 5.5 `anthropic/claude-opus-5.5` | $4 | $20 | yes | Very strong writing and long multi-step work, half Fable's price |

### Strong: everyday high quality

| Model | In | Out | Reads pictures | Why |
| --- | --- | --- | --- | --- |
| Anthropic: Claude Sonnet 5.5 `anthropic/claude-sonnet-5.5` | $2 | $10 | yes | Everyday writing and storyboards |
| ★ OpenAI: GPT-6.2 Sol `openai/gpt-6.2-sol` | $2 | $10 | yes | OpenAI's everyday model |
| Google: Gemini 4 Hydrogen `google/gemini-4-hydrogen` | $1.5 | $7.5 | yes | Gemini 4 workhorse, fast |
| SpaceXAI: Grok 4.7 `x-ai/grok-4.7` | $2 | $6 | yes | xAI flagship |
| Qwen: Qwen4 Max `qwen/qwen4-max` | $1.43 | $4.28 | yes | Alibaba flagship, low price for its class |

### Value: good and cheap

| Model | In | Out | Reads pictures | Why |
| --- | --- | --- | --- | --- |
| OpenAI: GPT-6.1 Terra `openai/gpt-6.1-terra` | $1 | $5 | yes | Mid-price OpenAI, good with screenshots |
| ★ Google: Gemini 3.8 Flash `google/gemini-3.8-flash` | $0.82 | $4.12 | yes | Fast, reads pictures, audio and video |
| Mistral: Mistral Large 4 `mistralai/mistral-large-4-0` | $0.7 | $2.1 | yes | Mistral flagship |
| ★ MoonshotAI: Kimi K3.1 Pro `moonshotai/kimi-k3.1-pro` | $0.24 | $8.4 | yes | Open-weight, cheap input, long context |

### Budget: very cheap

| Model | In | Out | Reads pictures | Why |
| --- | --- | --- | --- | --- |
| Anthropic: Claude Haiku 5.5 `anthropic/claude-haiku-5.5` | $0.1 | $0.5 | yes | Small and fast Claude |
| OpenAI: GPT-6 Luna `openai/gpt-6-luna` | $0.1 | $0.5 | yes | Small and fast GPT |
| ★ DeepSeek: DeepSeek V4.1 Flash `deepseek/deepseek-v4.1-flash` | $0.05 | $0.2 | yes | Very cheap, good reasoning |
| MiniMax: MiniMax M3.1 Flash `minimax/minimax-m3.1-flash` | $0.07 | $0.3 | yes | Very cheap, reads pictures |
| Qwen: Qwen3.8 Flash `qwen/qwen3.8-flash` | $0.15 | $0.47 | yes | Very cheap, reads pictures and video |

### Free (rate limited)

| Model | In | Out | Reads pictures | Why |
| --- | --- | --- | --- | --- |
| NVIDIA: Nemotron 3 Ultra (free) `nvidia/nemotron-3-ultra-550b-a55b:free` | free | free | no | Free, rate limited; large reasoning model |
| NVIDIA: Nemotron 3.5 Super VL (free) `nvidia/nemotron-3.5-super-vl:free` | free | free | yes | Free, rate limited; reads pictures |
| Google: Gemma 4 31B (free) `google/gemma-4-31b-it:free` | free | free | yes | Free, rate limited; Google open model |

All 363 text models stay pickable under "More models".

## Pictures (all of them)

About $ for one 1024 × 1024 picture, cheapest first. "Edits" = takes your pictures as input (references or editing).

**Suggested**

- ★ **OpenAI: GPT Image 2.6 Sunburst** `openai/gpt-image-2.6-sunburst` · best quality · about $0.032 a picture. #1 on AA text-to-image (1261); #2 on Arena's cartoon and anime board.
- ★ **OpenAI: GPT Image 2** `openai/gpt-image-2` · most proven · about $0.032 a picture. #5 on Arena's cartoon and anime board from 44,000 votes; #5 for editing.
- ★ **Google: Nano Banana 2.1** `google/gemini-nano-banana-2.1` · good and cheap · about $0.034 a picture. #8 on AA text-to-image; takes up to 14 reference pictures.
- ★ **Microsoft AI: MAI-Image-2.7** `microsoft/mai-image-2.7` · newest strong · priced by size and quality. #4 on Arena's cartoon and anime board; #4 for editing.

All pictures:

| Model | About $ a picture | Priced by | Edits | Max references |
| --- | --- | --- | --- | --- |
| Recraft: Recraft V4.1 Flash V2 `recraft/recraft-v4.1-flash-v2` | $0.007 | image | no | – |
| Recraft: Recraft V4.1 Flash `recraft/recraft-v4.1-flash` | $0.007 | image | no | – |
| OpenAI: GPT Image 1 Mini `openai/gpt-image-1-mini` | $0.008 | token | yes | 16 |
| OpenAI: GPT-5 Image Mini `openai/gpt-5-image-mini` | $0.008 | token | yes | 16 |
| Black Forest Labs: FLUX 3 Image Klein `black-forest-labs/flux-3-image-klein` | $0.009 | image | yes | 10 |
| Black Forest Labs: FLUX.2 Klein 4B `black-forest-labs/flux.2-klein-4b` | $0.015 | megapixel | yes | 4 |
| Krea: Krea 2 Medium Turbo `krea/krea-2-medium-turbo` | $0.015 | image | yes | 1 |
| ByteDance Seed: Seedream 5.0 Flash `bytedance-seed/seedream-5-0-flash` | $0.018 | image | yes | 14 |
| Qwen: Qwen Image 2.1 Turbo `qwen/qwen-image-2.1-turbo` | $0.018 | image | yes | 10 |
| Sourceful: Riverflow V2.5 Fast `sourceful/riverflow-v2.5-fast` | $0.019 | image | yes | 4 |
| ByteDance Seed: Seedream 5.5 `bytedance-seed/seedream-5-5` | $0.02 | image | yes | 10 |
| Sourceful: Riverflow V2 Fast `sourceful/riverflow-v2-fast` | $0.02 | image | yes | 4 |
| Krea: K3 Edit `krea/k3-edit` | $0.03 | image | yes | 8 |
| Qwen: Qwen Image 3 `qwen/qwen-image-3` | $0.03 | image | yes | 3 |
| Krea: Krea 2 Medium `krea/krea-2-medium` | $0.03 | image | yes | 1 |
| Black Forest Labs: FLUX.2 Pro `black-forest-labs/flux.2-pro` | $0.032 | megapixel | yes | 8 |
| ★ OpenAI: GPT Image 2.6 Sunburst `openai/gpt-image-2.6-sunburst` | $0.032 | token | yes | 16 |
| OpenAI: GPT Image 2.6 Flare `openai/gpt-image-2.6-flare` | $0.032 | token | yes | 16 |
| OpenAI: GPT Image 2.5 Sunburst `openai/gpt-image-2.5-sunburst` | $0.032 | token | yes | 16 |
| OpenAI: GPT Image 2.5 Flare `openai/gpt-image-2.5-flare` | $0.032 | token | yes | 16 |
| ★ OpenAI: GPT Image 2 `openai/gpt-image-2` | $0.032 | token | yes | 16 |
| OpenAI: GPT-5.4 Image 2 `openai/gpt-5.4-image-2` | $0.032 | token | yes | 16 |
| ★ Google: Nano Banana 2.1 `google/gemini-nano-banana-2.1` | $0.034 | token | yes | 14 |
| Google: Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image) `google/gemini-3.1-flash-lite-image` | $0.034 | token | yes | 14 |
| Recraft: Recraft V4 Styles `recraft/recraft-v4-styles` | $0.035 | image | yes | 10 |
| ByteDance Seed: Seedream 5.0 Lite `bytedance-seed/seedream-5-0-lite` | $0.035 | image | yes | 14 |
| Recraft: Recraft V4.1 Utility `recraft/recraft-v4.1-utility` | $0.035 | image | yes | 1 |
| Recraft: Recraft V4.1 `recraft/recraft-v4.1` | $0.035 | image | yes | 1 |
| Google: Nano Banana (Gemini 2.5 Flash Image) `google/gemini-2.5-flash-image` | $0.039 | token | yes | 3 |
| xAI: Grok Imagine Image 2.0 `x-ai/grok-imagine-image-2.0` | $0.04 | image | yes | 5 |
| Qwen: Qwen Image 3 Pro `qwen/qwen-image-3-pro` | $0.04 | image | yes | 3 |
| Recraft: Recraft V4 `recraft/recraft-v4` | $0.04 | image | yes | 1 |
| Recraft: Recraft V3 `recraft/recraft-v3` | $0.04 | image | yes | 1 |
| ByteDance Seed: Seedream 4.5 `bytedance-seed/seedream-4.5` | $0.04 | image | yes | 14 |
| OpenAI: GPT Image 1 `openai/gpt-image-1` | $0.042 | token | yes | 16 |
| OpenAI: GPT-5 Image `openai/gpt-5-image` | $0.042 | token | yes | 16 |
| ByteDance Seed: Seedream 5.0 Pro `bytedance-seed/seedream-5-0-pro` | $0.045 | image | yes | 14 |
| Qwen: Qwen Image 2.1 Pro `qwen/qwen-image-2.1-pro` | $0.046 | image | yes | 10 |
| Black Forest Labs: FLUX 3 Image `black-forest-labs/flux-3-image` | $0.048 | image | yes | 10 |
| Recraft: Recraft V4 Styles Vector `recraft/recraft-v4-styles-vector` | $0.05 | image | yes | 10 |
| Krea: Krea 2 Large `krea/krea-2-large` | $0.06 | image | yes | 1 |
| Black Forest Labs: FLUX.2 Flex `black-forest-labs/flux.2-flex` | $0.063 | megapixel | yes | 8 |
| Google: Nano Banana 2 (Gemini 3.1 Flash Image Preview) `google/gemini-3.1-flash-image-preview` | $0.067 | token | yes | 14 |
| Google: Nano Banana Pro (Gemini 3 Pro Image Preview) `google/gemini-3-pro-image-preview` | $0.067 | token | yes | 14 |
| Black Forest Labs: FLUX.2 Max `black-forest-labs/flux.2-max` | $0.073 | megapixel | yes | 8 |
| Google: Nano Banana 2 (Gemini 3.1 Flash Image) `google/gemini-3.1-flash-image` | $0.074 | token | yes | 14 |
| Recraft: Recraft V4.1 Vector `recraft/recraft-v4.1-vector` | $0.08 | image | yes | 1 |
| Recraft: Recraft V4 Vector `recraft/recraft-v4-vector` | $0.08 | image | yes | 1 |
| Recraft: Recraft V4 Styles Pro `recraft/recraft-v4-styles-pro` | $0.1 | image | yes | 10 |
| Recraft: Recraft V4 Styles Pro Vector `recraft/recraft-v4-styles-pro-vector` | $0.12 | image | yes | 10 |
| Sourceful: Riverflow V2.6 Pro `sourceful/riverflow-v2.6-pro` | $0.13 | image | yes | 10 |
| Sourceful: Riverflow V2.5 Pro `sourceful/riverflow-v2.5-pro` | $0.13 | image | yes | 10 |
| Google: Nano Banana Pro (Gemini 3 Pro Image) `google/gemini-3-pro-image` | $0.134 | token | yes | 14 |
| Sourceful: Riverflow V2 Pro `sourceful/riverflow-v2-pro` | $0.15 | image | yes | 10 |
| Recraft: Recraft V4.1 Utility Pro `recraft/recraft-v4.1-utility-pro` | $0.21 | image | yes | 1 |
| Recraft: Recraft V4.1 Pro `recraft/recraft-v4.1-pro` | $0.21 | image | yes | 1 |
| Recraft: Recraft V4 Pro `recraft/recraft-v4-pro` | $0.25 | image | yes | 1 |
| Recraft: Recraft V4.1 Pro Vector `recraft/recraft-v4.1-pro-vector` | $0.3 | image | yes | 1 |
| Recraft: Recraft V4 Pro Vector `recraft/recraft-v4-pro-vector` | $0.3 | image | yes | 1 |
| Microsoft AI: MAI-Image-2.7 Flash `microsoft/mai-image-2.7-flash` | by size and quality | token | yes | 5 |
| ★ Microsoft AI: MAI-Image-2.7 `microsoft/mai-image-2.7` | by size and quality | token | yes | 5 |
| Tencent: HY-World 2.1 Panorama `tencent/hy-world-2.1-panorama` | by size and quality | token | no | – |
| MiniMax: MiniMax H3 Image Highspeed `minimax/minimax-h3-image-highspeed` | by size and quality | token | yes | 16 |
| MiniMax: MiniMax H3 Image `minimax/minimax-h3-image` | by size and quality | token | yes | 16 |
| Tencent: Hy Image 3.5 Preview `tencent/hy-image-v3.5-preview` | by size and quality | token | yes | 20 |
| Microsoft AI: MAI-Image-2.6 `microsoft/mai-image-2.6` | by size and quality | token | yes | 5 |
| Microsoft AI: MAI-Image-2.6 Flash `microsoft/mai-image-2.6-flash` | by size and quality | token | yes | 5 |
| Meta: Muse Image `meta/muse-image` | by size and quality | unknown | yes | – |
| Microsoft AI: MAI-Image-2.5 Pro `microsoft/mai-image-2.5-pro` | by size and quality | token | yes | 1 |
| Microsoft AI: MAI-Image-2.5 `microsoft/mai-image-2.5` | by size and quality | token | yes | 1 |

## Video (all of them)

$ per second of video.

**Suggested**

- ★ **Google: Gemini Omni 1.2 Flash** `google/gemini-omni-1.2-flash` · newest strong · 720p $0.07/s, 1080p $0.104/s, 4K $0.208/s, 360p $0.023/s. #1 on Arena image-to-video and text-to-video; $0.07 a second at 720p with sound.
- ★ **Alibaba: Wan 3.0** `alibaba/wan-3.0` · best value · 480p $0.05/s, 720p $0.1/s, 1080p $0.2/s. #1 on AA text-to-video (1174); $0.05–0.10 a second with sound, up to 30 s.
- ★ **ByteDance: Seedance 2.5** `bytedance/seedance-2.5` · best quality · 480p $0.103/s, 720p $0.231/s, 1080p $0.569/s. #1 on AA image-to-video (1161); #2 on Arena.
- ★ **MiniMax: H3** `minimax/hailuo-3` · strong, with sound · 2K $0.13/s. MiniMax H3: #3 on Arena image-to-video; 2K with sound.
- ★ **ByteDance: Seedance 2.0** `bytedance/seedance-2.0` · best value · 480p $0.067/s, 720p $0.151/s, 1080p $0.374/s, 4K $0.778/s. #3 on AA image-to-video at about 2/3 of Seedance 2.5's price.

### Make video

| Model | $ per second | Sound | Start/end frames | Lengths |
| --- | --- | --- | --- | --- |
| TBC: mischief 1 `tbc/mischief-1` | 480p $0.005, 720p $0.01 | no | first | 3–5 s |
| SpaceXAI: Grok Imagine Video 1.5 Lite `x-ai/grok-imagine-video-1.5-lite` | 480p $0.02, 720p $0.03, 1080p $0.14 | yes | first | 1–15 s |
| HeyGen: HeyGen Video `heygen/heygen-video-1` | 480p $0.02, 768p $0.036, 1080p $0.1, 2K $0.1 | no | first | 5–30 s |
| ★ Google: Gemini Omni 1.2 Flash `google/gemini-omni-1.2-flash` | 720p $0.07, 1080p $0.104, 4K $0.208, 360p $0.023 | yes | first + last | 3–15 s |
| ByteDance: Seedance 2.0 Mini `bytedance/seedance-2.0-mini` | 480p $0.034, 720p $0.076 | yes | first + last | 4–15 s |
| Google: Gemini Omni 1.1 Flash `google/gemini-omni-1.1-flash` | 720p $0.101, 1080p $0.152, 4K $0.304, 360p $0.034 | yes | first + last | 3–10 s |
| MiniMax: H3 Max `minimax/hailuo-3-max` | 768p $0.08, 480p $0.05 | no | first + last | 5–15 s |
| ★ Alibaba: Wan 3.0 `alibaba/wan-3.0` | 480p $0.05, 720p $0.1, 1080p $0.2 | yes | first + last | 2–30 s |
| SpaceXAI: Grok Imagine Video `x-ai/grok-imagine-video` | 480p $0.05, 720p $0.07 | no | first | 1–15 s |
| Google: Veo 3.1 Lite `google/veo-3.1-lite` | 720p $0.05, 1080p $0.08 | yes | first + last | 4–8 s |
| ByteDance: Seedance 2.0 Fast `bytedance/seedance-2.0-fast` | 480p $0.054, 720p $0.121 | yes | first + last | 4–15 s |
| ByteDance: Seedance 2.5 Flash `bytedance/seedance-2.5-flash` | 480p $0.067, 720p $0.151 | yes | first + last | 4–30 s |
| ★ ByteDance: Seedance 2.0 `bytedance/seedance-2.0` | 480p $0.067, 720p $0.151, 1080p $0.374, 4K $0.778 | yes | first + last | 4–15 s |
| Alibaba: Wan 3.0 Prime `alibaba/wan-3.0-prime` | 480p $0.068, 720p $0.14, 1080p $0.28 | yes | first + last | 2–30 s |
| SpaceXAI: Grok Imagine Video 1.5 `x-ai/grok-imagine-video-1.5` | 480p $0.08, 720p $0.14, 1080p $0.25 | yes | first | 1–15 s |
| MiniMax: Hailuo 2.3 `minimax/hailuo-2.3` | 1080p $0.082 | no | first | 6–10 s |
| Kling: Video v3.0 Standard `kwaivgi/kling-v3.0-std` | 720p $0.084 | yes | first + last | 3–15 s |
| Alibaba: HappyHorse 1.1 `alibaba/happyhorse-1.1` | 720p $0.099, 1080p $0.128 | no | first | 3–15 s |
| Alibaba: HappyHorse 1.0 `alibaba/happyhorse-1.0` | 720p $0.099, 1080p $0.169 | no | first | 3–15 s |
| Google: Veo 3.1 Fast `google/veo-3.1-fast` | 720p $0.1, 1080p $0.12, 4K $0.3 | yes | first + last | 4–8 s |
| Alibaba: Wan 2.7 `alibaba/wan-2.7` | 720p $0.1, 1080p $0.1 | yes | first + last | 2–10 s |
| Alibaba: Wan 2.6 `alibaba/wan-2.6` | 720p $0.1, 1080p $0.15 | yes | first | 5–10 s |
| ★ ByteDance: Seedance 2.5 `bytedance/seedance-2.5` | 480p $0.103, 720p $0.231, 1080p $0.569 | yes | first + last | 4–30 s |
| Kling: Video v3.0 Pro `kwaivgi/kling-v3.0-pro` | 720p $0.112 | yes | first + last | 3–15 s |
| Kling: Video O1 `kwaivgi/kling-video-o1` | 720p $0.112 | yes | first + last | 5–10 s |
| Runway: Gen-4.5 `runway/gen-4.5` | 720p $0.12 | no | first | 2–10 s |
| ★ MiniMax: H3 `minimax/hailuo-3` | 2K $0.13 | yes | first + last | 5–15 s |
| Black Forest Labs: FLUX 3 Video `black-forest-labs/flux-3-video` | 720p $0.17, 1080p $0.29, 2K $0.28, 4K $0.41 | yes | first + last | 5–20 s |
| Google: Veo 3.1 `google/veo-3.1` | 720p $0.4, 1080p $0.4, 4K $0.6 | yes | first + last | 4–8 s |

### Talking avatars / lip sync

| Model | $ per second | Sound | Start/end frames | Lengths |
| --- | --- | --- | --- | --- |
| HeyGen: Avatar 6 Turbo `heygen/heygen-avatar-6-turbo` | 1080p $0.05, 2K $0.087 | no | – | – |
| HeyGen: Avatar IV `heygen/avatar-iv` | 720p $0.05, 1080p $0.05 | no | – | – |
| HeyGen: Avatar 6 `heygen/heygen-avatar-6` | 1080p $0.1, 2K $0.145 | no | – | – |

### Edit a video

| Model | $ per second | Sound | Start/end frames | Lengths |
| --- | --- | --- | --- | --- |
| Black Forest Labs: FLUX Video Edit `black-forest-labs/flux-video-edit` | any $0.03 | no | – | – |
| Runway: Aleph 2.0 `runway/aleph-2` | any $0.28 | no | – | – |

### Upscale a video

| Model | $ per second | Sound | Start/end frames | Lengths |
| --- | --- | --- | --- | --- |
| Black Forest Labs: FLUX Video Upscale `black-forest-labs/flux-video-upscale` | to 1080p $0.073 | no | – | – |

## Voice, music, speech to text

OpenRouter has **no voice-acting (text-to-speech) models**. For character voices use Google AI Studio (Gemini voices, cheapest) or ElevenLabs (cloning, sound effects).

- Voice: OpenAI: GPT Audio `openai/gpt-audio`: a chat model that answers out loud; not a voice-acting model
- Voice: OpenAI: GPT Audio Mini `openai/gpt-audio-mini`: a chat model that answers out loud; not a voice-acting model
- Music: Google: Lyria 3 Pro Preview `google/lyria-3-pro-preview`: full-length songs, $0.08 a song
- Music: Google: Lyria 3 Clip Preview `google/lyria-3-clip-preview`: short music clips
- Speech to text: Google: Gemini 3.8 Flash `google/gemini-3.8-flash`
- Speech to text: OpenAI: GPT Audio Mini `openai/gpt-audio-mini`
- Speech to text: Qwen: Qwen3.8 Omni Flash `qwen/qwen3.8-omni-flash`
