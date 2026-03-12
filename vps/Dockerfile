FROM alpine:latest
RUN apk add --no-cache wireguard-tools iptables iproute2 bash curl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
VOLUME /config
EXPOSE 51820/udp
ENTRYPOINT ["/entrypoint.sh"]
