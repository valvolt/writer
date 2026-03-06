# Use lightweight Node.js image
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (leverage Docker layer cache)
COPY package.json package-lock.json* ./

# Install production dependencies as root (required for package installs)
RUN npm install --production

# Copy application source
COPY . .

# Ensure the stories directory exists and set ownership
RUN mkdir -p ./stories

# Create a non-root user and group, and make /app owned by that user.
# We create the user after installing deps so installs run as root (safer for permissions).
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /app

# Install su-exec so we can drop privileges at container start (handles host-mounted volumes)
RUN apk add --no-cache su-exec

# Copy entrypoint script and make it executable
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Use entrypoint: it will chown /app/stories (handles host bind mounts) and then drop to appuser
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Default command (runs as appuser via su-exec in the entrypoint)
CMD ["node", "server.js"]
