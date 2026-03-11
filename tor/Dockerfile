FROM alpine:edge

RUN apk add --no-cache tor bash netcat-openbsd iproute2 ca-certificates

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
