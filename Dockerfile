FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS ui
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY vendor/culprit/packages/culprit-archive-client/src vendor/culprit/packages/culprit-archive-client/src
COPY vendor/culprit/app/src/gen vendor/culprit/app/src/gen
COPY vendor/culprit/docs/images/logo.svg vendor/culprit/docs/images/logo.svg
COPY src/ui src/ui
COPY index.html vite.config.ts tsconfig.json ./
RUN bun run build

FROM rust:1-bookworm@sha256:114c7a4425406451c2866b6aafe69fe29b1b298832db1277d411ac73c82d04d6 AS server
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY vendor/culprit vendor/culprit
COPY src/*.rs src/
COPY tests/native/publish_incident.rs tests/native/
RUN cargo build --locked --release

FROM amazon/aws-cli:2.31.10@sha256:c3545440ffb85aac40c104d7fe5cb885d0ed26e91d95a433094a9dba9ddfacd6 AS aws
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && install -d -o 65532 -g 65532 /var/lib/culprit-web
COPY --from=aws /usr/local/aws-cli /usr/local/aws-cli
RUN ln -s /usr/local/aws-cli/v2/current/bin/aws /usr/local/bin/aws
WORKDIR /app
COPY --from=ui /src/dist dist
COPY --from=server /src/target/release/culprit-web /usr/local/bin/culprit-web
COPY vendor/culprit/LICENSE /usr/share/doc/culprit-web/upstream-LICENSE
USER 65532:65532
ENV CULPRIT_WEB_BIND=0.0.0.0:8080
ENV HOME=/var/lib/culprit-web
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/culprit-web"]
CMD ["/run/config/web.json"]
