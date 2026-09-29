-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('MOBILE', 'DESKTOP');

-- CreateTable
CREATE TABLE "BoundDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL,
    "deviceKeyHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoundDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceLoginAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceLoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoundDevice_userId_idx" ON "BoundDevice"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BoundDevice_userId_deviceType_key" ON "BoundDevice"("userId", "deviceType");

-- CreateIndex
CREATE INDEX "DeviceLoginAttempt_userId_idx" ON "DeviceLoginAttempt"("userId");

-- CreateIndex
CREATE INDEX "DeviceLoginAttempt_createdAt_idx" ON "DeviceLoginAttempt"("createdAt");

-- AddForeignKey
ALTER TABLE "BoundDevice" ADD CONSTRAINT "BoundDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLoginAttempt" ADD CONSTRAINT "DeviceLoginAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
