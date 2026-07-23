# render-service — WebGPU rendering with NO real GPU.
#
# Railway has only CPU containers, so we render the cafe uber-shader in SOFTWARE
# via Mesa's lavapipe (a software Vulkan driver). Deno's WebGPU (wgpu) picks
# lavapipe up as its adapter. Our shaders are tiny (512x512, a few frames), so
# CPU rasterization is sub-second — plenty for an agent's eyes.
FROM debian:bookworm-slim

# lavapipe (mesa-vulkan-drivers) + the Vulkan loader, plus curl/unzip/CA certs
# for installing Deno and fetching npm:/jsr: deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
      mesa-vulkan-drivers libvulkan1 vulkan-tools \
      ca-certificates curl unzip \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Deno — pinned to the version proven locally (2.9.2).
ENV DENO_INSTALL=/usr/local
RUN curl -fsSL https://deno.land/install.sh | sh -s v2.9.2
ENV PATH="/usr/local/bin:${PATH}"

# Force the software ICD so the Vulkan loader never hunts for absent hardware.
ENV VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json
ENV LIBGL_ALWAYS_SOFTWARE=1

WORKDIR /app
COPY render-core.mjs server.mjs prelude.mjs ./

# Pre-cache npm:/jsr: deps into the image so cold starts don't fetch them.
RUN deno cache server.mjs

EXPOSE 8080
CMD ["deno", "run", "--unstable-webgpu", "-A", "server.mjs"]
