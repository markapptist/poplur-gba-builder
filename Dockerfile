# devkitARM + Butano, pinned. The builder gets no Firebase credentials and no
# database handle: it receives a validated spec on stdin and returns bytes.
FROM devkitpro/devkitarm:20240202

ENV DEVKITPRO=/opt/devkitpro
ENV DEVKITARM=/opt/devkitpro/devkitARM
ENV BUTANO_VERSION=17.3.0

# Debian bullseye ships Node 12, which predates nullish coalescing and optional
# chaining. Take Node 20 from NodeSource instead of writing the build script to
# a decade-old runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 curl ca-certificates unzip gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && node --version \
    && rm -rf /var/lib/apt/lists/*

# Butano vendored at a fixed tag so a ROM built today builds identically later.
RUN curl -fsSL "https://github.com/GValiente/butano/archive/refs/tags/${BUTANO_VERSION}.tar.gz" \
      -o /tmp/butano.tar.gz \
    && mkdir -p /opt/butano \
    && tar -xzf /tmp/butano.tar.gz -C /opt/butano --strip-components=1 \
    && rm /tmp/butano.tar.gz

ENV BUTANO=/opt/butano/butano

WORKDIR /build
COPY template/ /build/template/
COPY codegen.mjs build.mjs /build/

# No network is needed once the image is built; the job should run with egress
# limited to its artifact upload.
ENTRYPOINT ["node", "/build/build.mjs"]
