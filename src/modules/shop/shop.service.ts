import type { Prisma } from '@prisma/client'
import type { z } from 'zod'
import { prisma } from '../../config/db.js'
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js'
import { generateUniqueSlug, slugifyTitle } from '../../lib/slug.js'
import { OrderStatus, ProductAccessSource, ProductAccessStatus, Role } from '../../shared/enums.js'
import {
  createOrderSchema,
  createProductSchema,
  productListQuerySchema,
  updateProductSchema,
  reviewOrderSchema,
  grantManualProductAccessSchema,
  updateProductAccessSchema,
} from '../../shared/schemas/shop.js'
import type { ApiListResponse } from '../../shared/types/index.js'
import {
  toAdminOrderRequest,
  toAdminProductAccessItem,
  toOrderListItem,
  toProductDetail,
  toProductListItem,
  type AdminOrderRequestDto,
  type AdminProductAccessItemDto,
  type OrderListItemDto,
  type ProductDetailDto,
  type ProductDigitalAccessDto,
  type ProductListItem,
} from './shop.mapper.js'

type CreateProductInput = z.infer<typeof createProductSchema>
type UpdateProductInput = z.infer<typeof updateProductSchema>
type ProductListQuery = z.infer<typeof productListQuerySchema>
type CreateOrderInput = z.infer<typeof createOrderSchema>
type ReviewOrderInput = z.infer<typeof reviewOrderSchema>
type GrantManualProductAccessInput = z.infer<typeof grantManualProductAccessSchema>
type UpdateProductAccessInput = z.infer<typeof updateProductAccessSchema>

const productAccessProductSelect = {
  id: true,
  title: true,
  slug: true,
  type: true,
  priceMinor: true,
  thumbnail: true,
} satisfies Prisma.ProductSelect

async function assertActiveStudent(studentId: string): Promise<void> {
  const student = await prisma.user.findUnique({ where: { id: studentId } })
  if (!student || student.deletedAt || !student.isActive) {
    throw validationError('Student account is inactive')
  }
  if (student.role !== Role.STUDENT) {
    throw validationError('Selected user is not a student')
  }
}

async function upsertProductAccessForOrderItems(
  tx: Prisma.TransactionClient,
  userId: string,
  orderId: string,
  items: { productId: string }[],
  source: ProductAccessSource,
  grantedByAdminId?: string,
): Promise<void> {
  for (const item of items) {
    await tx.productAccess.upsert({
      where: {
        userId_productId: { userId, productId: item.productId },
      },
      create: {
        userId,
        productId: item.productId,
        status: ProductAccessStatus.ACTIVE,
        source,
        orderId,
        grantedByAdminId: grantedByAdminId ?? null,
      },
      update: {
        status: ProductAccessStatus.ACTIVE,
        source,
        orderId,
        ...(grantedByAdminId ? { grantedByAdminId } : {}),
      },
    })
  }
}

function parseSort(sort?: string): Prisma.ProductOrderByWithRelationInput {
  if (!sort) return { createdAt: 'desc' }
  const [field, dir] = sort.split(':')
  const allowed = new Set(['createdAt', 'title', 'priceMinor', 'updatedAt'])
  if (!allowed.has(field)) return { createdAt: 'desc' }
  return { [field]: dir === 'asc' ? 'asc' : 'desc' }
}

export async function listProducts(
  query: ProductListQuery,
  publishedOnly: boolean,
): Promise<ApiListResponse<ProductListItem>> {
  const { page, pageSize, search, type, sort, dateFrom, dateTo } = query
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(publishedOnly ? { isPublished: true } : {}),
    ...(type ? { type } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: parseSort(sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ])

  return {
    data: rows.map(toProductListItem),
    meta: { page, pageSize, total },
  }
}

export async function getProductByIdOrSlug(
  idOrSlug: string,
  includeStaffFields: boolean,
): Promise<ProductDetailDto> {
  const product = await prisma.product.findFirst({
    where: {
      deletedAt: null,
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      ...(includeStaffFields ? {} : { isPublished: true }),
    },
  })
  if (!product) {
    throw notFound('Product not found')
  }
  return toProductDetail(product, includeStaffFields)
}

export async function createProduct(input: CreateProductInput): Promise<ProductDetailDto> {
  const titleTaken = await prisma.product.findFirst({
    where: {
      deletedAt: null,
      title: { equals: input.title, mode: 'insensitive' },
    },
  })
  if (titleTaken) {
    throw conflict('A product with this title already exists')
  }

  const slug =
    input.slug ??
    (await generateUniqueSlug(slugifyTitle(input.title), async (candidate) => {
      const existing = await prisma.product.findFirst({
        where: { slug: candidate, deletedAt: null },
      })
      return existing !== null
    }))

  const product = await prisma.product.create({ data: { ...input, slug } })
  return toProductDetail(product, true)
}

export async function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<ProductDetailDto> {
  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null },
  })
  if (!product) {
    throw notFound('Product not found')
  }

  if (input.title && input.title.toLowerCase() !== product.title.toLowerCase()) {
    const titleTaken = await prisma.product.findFirst({
      where: {
        deletedAt: null,
        title: { equals: input.title, mode: 'insensitive' },
        id: { not: id },
      },
    })
    if (titleTaken) {
      throw conflict('A product with this title already exists')
    }
  }

  if (input.slug && input.slug !== product.slug) {
    const slugTaken = await prisma.product.findFirst({
      where: { slug: input.slug, deletedAt: null, id: { not: id } },
    })
    if (slugTaken) {
      throw conflict('Product slug already exists')
    }
  }

  const updated = await prisma.product.update({
    where: { id },
    data: input,
  })
  return toProductDetail(updated, true)
}

export async function deleteProduct(id: string): Promise<void> {
  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null },
  })
  if (!product) {
    throw notFound('Product not found')
  }

  await prisma.product.update({
    where: { id },
    data: { deletedAt: new Date(), isPublished: false },
  })
}

export async function createOrder(
  userId: string,
  input: CreateOrderInput,
): Promise<OrderListItemDto> {
  const productIds = [...new Set(input.items.map((item) => item.productId))]
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      deletedAt: null,
      isPublished: true,
    },
  })

  if (products.length !== productIds.length) {
    throw notFound('One or more products not found')
  }

  const productById = new Map(products.map((p) => [p.id, p]))
  let totalMinor = 0
  const lineItems: {
    productId: string
    quantity: number
    unitPriceMinor: number
    title: string
  }[] = []

  for (const item of input.items) {
    const product = productById.get(item.productId)!
    if (product.priceMinor <= 0) {
      throw validationError(`"${product.title}" is not available for purchase`)
    }
    if (product.stock != null && product.stock < item.quantity) {
      throw validationError(`Insufficient stock for "${product.title}"`)
    }
    totalMinor += product.priceMinor * item.quantity
    lineItems.push({
      productId: product.id,
      quantity: item.quantity,
      unitPriceMinor: product.priceMinor,
      title: product.title,
    })
  }

  const order = await prisma.$transaction(async (tx) => {
    return tx.order.create({
      data: {
        userId,
        status: OrderStatus.PENDING,
        totalMinor,
        items: {
          create: lineItems,
        },
      },
      include: { items: true },
    })
  })

  return toOrderListItem(order)
}

const adminOrderInclude = {
  items: true,
  user: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.OrderInclude

export async function listAdminOrders(
  status?: OrderStatus,
): Promise<AdminOrderRequestDto[]> {
  const rows = await prisma.order.findMany({
    where: status ? { status } : {},
    include: adminOrderInclude,
    orderBy: { createdAt: 'desc' },
  })
  return rows.map((row) => toAdminOrderRequest(row))
}

export async function reviewOrderRequest(
  orderId: string,
  input: ReviewOrderInput,
): Promise<AdminOrderRequestDto> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, user: { select: { id: true, name: true, phone: true } } },
  })
  if (!order) {
    throw notFound('Order not found')
  }
  if (order.status !== OrderStatus.PENDING) {
    throw validationError('Only pending orders can be reviewed')
  }

  if (input.action === 'cancel') {
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
      include: adminOrderInclude,
    })
    return toAdminOrderRequest(updated)
  }

  const updated = await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } })
      if (product?.stock != null) {
        const result = await tx.product.updateMany({
          where: { id: product.id, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        })
        if (result.count === 0) {
          throw validationError(`Insufficient stock for "${item.title}"`)
        }
      }
    }

    const confirmed = await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CONFIRMED, confirmedAt: new Date() },
      include: adminOrderInclude,
    })

    await upsertProductAccessForOrderItems(
      tx,
      order.userId,
      orderId,
      order.items,
      ProductAccessSource.ORDER,
    )

    return confirmed
  })

  return toAdminOrderRequest(updated)
}

export async function listMyOrders(userId: string): Promise<OrderListItemDto[]> {
  const rows = await prisma.order.findMany({
    where: { userId },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(toOrderListItem)
}

export async function getMyOrder(userId: string, orderId: string): Promise<OrderListItemDto> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { items: true },
  })
  if (!order) {
    throw notFound('Order not found')
  }
  return toOrderListItem(order)
}

async function findPublishedProduct(idOrSlug: string) {
  return prisma.product.findFirst({
    where: {
      deletedAt: null,
      isPublished: true,
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    },
  })
}

export async function userHasPurchasedProduct(userId: string, productId: string): Promise<boolean> {
  const access = await prisma.productAccess.findUnique({
    where: {
      userId_productId: { userId, productId },
    },
    select: { status: true },
  })
  return access?.status === ProductAccessStatus.ACTIVE
}

export async function grantManualProductAccess(
  adminId: string,
  input: GrantManualProductAccessInput,
): Promise<AdminProductAccessItemDto[]> {
  await assertActiveStudent(input.studentId)

  const productIds = [...new Set(input.productIds)]
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      deletedAt: null,
      isPublished: true,
    },
  })

  if (products.length !== productIds.length) {
    throw notFound('One or more products not found')
  }

  const existingAccess = await prisma.productAccess.findMany({
    where: {
      userId: input.studentId,
      productId: { in: productIds },
      status: ProductAccessStatus.ACTIVE,
    },
    select: { productId: true },
  })
  if (existingAccess.length > 0) {
    const titles = products
      .filter((p) => existingAccess.some((a) => a.productId === p.id))
      .map((p) => `"${p.title}"`)
    throw validationError(`Student already has access to ${titles.join(', ')}`)
  }

  const productById = new Map(products.map((p) => [p.id, p]))
  let totalMinor = 0
  const lineItems = productIds.map((productId) => {
    const product = productById.get(productId)!
    if (product.priceMinor <= 0) {
      throw validationError(`"${product.title}" is not available for sale`)
    }
    totalMinor += product.priceMinor
    return {
      productId: product.id,
      quantity: 1,
      unitPriceMinor: product.priceMinor,
      title: product.title,
    }
  })

  const accessRows = await prisma.$transaction(async (tx) => {
    for (const item of lineItems) {
      const product = productById.get(item.productId)!
      if (product.stock != null) {
        const result = await tx.product.updateMany({
          where: { id: product.id, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        })
        if (result.count === 0) {
          throw validationError(`Insufficient stock for "${item.title}"`)
        }
      }
    }

    const order = await tx.order.create({
      data: {
        userId: input.studentId,
        status: OrderStatus.CONFIRMED,
        totalMinor,
        confirmedAt: new Date(),
        items: { create: lineItems },
      },
    })

    await upsertProductAccessForOrderItems(
      tx,
      input.studentId,
      order.id,
      lineItems,
      ProductAccessSource.MANUAL,
      adminId,
    )

    return tx.productAccess.findMany({
      where: {
        userId: input.studentId,
        productId: { in: productIds },
      },
      include: { product: { select: productAccessProductSelect } },
      orderBy: { grantedAt: 'desc' },
    })
  })

  return accessRows.map(toAdminProductAccessItem)
}

export async function listStudentProductAccess(
  studentId: string,
): Promise<AdminProductAccessItemDto[]> {
  await assertActiveStudent(studentId)

  const rows = await prisma.productAccess.findMany({
    where: { userId: studentId },
    include: { product: { select: productAccessProductSelect } },
    orderBy: { grantedAt: 'desc' },
  })

  return rows.map(toAdminProductAccessItem)
}

export async function updateProductAccessStatus(
  accessId: string,
  input: UpdateProductAccessInput,
): Promise<AdminProductAccessItemDto> {
  const access = await prisma.productAccess.findUnique({
    where: { id: accessId },
    include: { product: { select: productAccessProductSelect } },
  })
  if (!access) {
    throw notFound('Product access not found')
  }

  let nextStatus: ProductAccessStatus
  if (input.action === 'block') {
    if (access.status === ProductAccessStatus.WITHDRAWN) {
      throw validationError('Withdrawn access cannot be blocked')
    }
    nextStatus = ProductAccessStatus.BLOCKED
  } else if (input.action === 'unblock') {
    if (access.status !== ProductAccessStatus.BLOCKED) {
      throw validationError('Only blocked access can be unblocked')
    }
    nextStatus = ProductAccessStatus.ACTIVE
  } else {
    nextStatus = ProductAccessStatus.WITHDRAWN
  }

  const updated = await prisma.productAccess.update({
    where: { id: accessId },
    data: { status: nextStatus },
    include: { product: { select: productAccessProductSelect } },
  })

  return toAdminProductAccessItem(updated)
}

export async function getProductDigitalAccess(
  userId: string | undefined,
  idOrSlug: string,
): Promise<ProductDigitalAccessDto> {
  const product = await findPublishedProduct(idOrSlug)
  if (!product) {
    throw notFound('Product not found')
  }

  const hasFullAccess = userId ? await userHasPurchasedProduct(userId, product.id) : false

  return {
    hasFullAccess,
    freePreviewPages: product.freePreviewPages,
    hasDigitalFile: Boolean(product.digitalUrl),
  }
}

export async function streamProductPdf(
  userId: string | undefined,
  idOrSlug: string,
): Promise<{ buffer: Buffer; contentType: string; title: string; isPreview: boolean }> {
  const product = await findPublishedProduct(idOrSlug)
  if (!product?.digitalUrl) {
    throw notFound('Digital file not found')
  }

  const hasFullAccess = userId ? await userHasPurchasedProduct(userId, product.id) : false

  const upstream = await fetch(product.digitalUrl)
  if (!upstream.ok) {
    throw notFound('File could not be loaded from storage')
  }

  const fullBuffer = Buffer.from(await upstream.arrayBuffer())

  if (!hasFullAccess && product.freePreviewPages <= 0) {
    throw forbidden('Purchase required to view this document')
  }

  return {
    buffer: fullBuffer,
    contentType: 'application/pdf',
    title: product.title,
    isPreview: !hasFullAccess,
  }
}
