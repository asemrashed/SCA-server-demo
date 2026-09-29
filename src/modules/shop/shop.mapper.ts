import type { Product } from '@prisma/client'
import type { ProductAccessSource, ProductAccessStatus, ProductType } from '../../shared/enums.js'

export interface ProductListItem {
  id: string
  title: string
  slug: string
  thumbnail: string | null
  type: ProductType
  priceMinor: number
  isPublished: boolean
  createdAt: string
}

export interface ProductDetailDto {
  id: string
  title: string
  slug: string
  description: string | null
  thumbnail: string | null
  type: ProductType
  priceMinor: number
  stock: number | null
  isPublished: boolean
  freePreviewPages: number
  hasDigitalFile: boolean
  digitalUrl?: string | null
}

export interface ProductDigitalAccessDto {
  hasFullAccess: boolean
  freePreviewPages: number
  hasDigitalFile: boolean
}

export interface OrderItemDto {
  id: string
  productId: string
  title: string
  quantity: number
  unitPriceMinor: number
  lineTotalMinor: number
}

export interface OrderListItemDto {
  id: string
  status: string
  totalMinor: number
  createdAt: string
  itemCount: number
  items: OrderItemDto[]
}

export function toProductListItem(product: Product): ProductListItem {
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    thumbnail: product.thumbnail,
    type: product.type as ProductType,
    priceMinor: product.priceMinor,
    isPublished: product.isPublished,
    createdAt: product.createdAt.toISOString(),
  }
}

export function toProductDetail(product: Product, includeDigitalUrl: boolean): ProductDetailDto {
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    description: product.description,
    thumbnail: product.thumbnail,
    type: product.type as ProductType,
    priceMinor: product.priceMinor,
    stock: product.stock,
    isPublished: product.isPublished,
    freePreviewPages: product.freePreviewPages,
    hasDigitalFile: Boolean(product.digitalUrl),
    ...(includeDigitalUrl ? { digitalUrl: product.digitalUrl } : {}),
  }
}

type OrderWithItems = {
  id: string
  status: string
  totalMinor: number
  createdAt: Date
  items: {
    id: string
    productId: string
    title: string
    quantity: number
    unitPriceMinor: number
  }[]
}

export interface AdminOrderRequestDto extends OrderListItemDto {
  student: {
    id: string
    name: string
    phone: string
  }
}

type OrderWithItemsAndStudent = OrderWithItems & {
  user: { id: string; name: string; phone: string }
}

export function toAdminOrderRequest(order: OrderWithItemsAndStudent): AdminOrderRequestDto {
  return {
    ...toOrderListItem(order),
    student: {
      id: order.user.id,
      name: order.user.name,
      phone: order.user.phone,
    },
  }
}

export function toOrderListItem(order: OrderWithItems): OrderListItemDto {
  return {
    id: order.id,
    status: order.status,
    totalMinor: order.totalMinor,
    createdAt: order.createdAt.toISOString(),
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      title: item.title,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.unitPriceMinor * item.quantity,
    })),
  }
}

export interface AdminProductAccessItemDto {
  id: string
  status: ProductAccessStatus
  source: ProductAccessSource
  grantedAt: string
  updatedAt: string
  orderId: string | null
  product: {
    id: string
    title: string
    slug: string
    type: ProductType
    priceMinor: number
    thumbnail: string | null
  }
}

type ProductAccessWithProduct = {
  id: string
  status: string
  source: string
  grantedAt: Date
  updatedAt: Date
  orderId: string | null
  product: {
    id: string
    title: string
    slug: string
    type: string
    priceMinor: number
    thumbnail: string | null
  }
}

export function toAdminProductAccessItem(row: ProductAccessWithProduct): AdminProductAccessItemDto {
  return {
    id: row.id,
    status: row.status as ProductAccessStatus,
    source: row.source as ProductAccessSource,
    grantedAt: row.grantedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    orderId: row.orderId,
    product: {
      id: row.product.id,
      title: row.product.title,
      slug: row.product.slug,
      type: row.product.type as ProductType,
      priceMinor: row.product.priceMinor,
      thumbnail: row.product.thumbnail,
    },
  }
}
