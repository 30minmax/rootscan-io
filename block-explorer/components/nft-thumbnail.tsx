import { getNft } from "@/lib/api"
import { cn } from "@/lib/utils"
import Image from "next/image"

const getData = async ({ contractAddress, tokenId }) => {
  if (!contractAddress) return null
  const data = await getNft({ contractAddress, tokenId })
  return data
}

export default async function NftThumbnail({ contractAddress, tokenId }) {
  const data = await getData({ contractAddress, tokenId })
  const size = `h-12 w-12`
  if (!data?.image) {
    return (
      <div
        className={cn([
          size,
          `grid select-none place-items-center rounded-xl bg-muted text-muted-foreground`,
        ])}
      >
        <div>NFT</div>
      </div>
    )
  }
  return (
    <Image
      src={data?.image}
      width={250}
      height={250}
      alt="nft_image"
      unoptimized
      className={cn([size, "shrink-0 rounded-xl"])}
    />
  )
}