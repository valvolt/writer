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

# Expose port
EXPOSE 3000

# Run the server as non-root user
USER appuser

# Start the server
CMD ["node", "server.js"]