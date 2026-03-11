FROM alpine:latest
RUN apk add --no-cache wireguard-tools iptables iproute2 bash curl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
