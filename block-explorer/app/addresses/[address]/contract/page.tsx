import CardDetail from "@/components/ui/card-detail"
import { getContractVerification } from "@/lib/api"
import Link from "next/link"
import CodeEditor from "./components/code-editor"

const getData = async ({ params, searchParams }) => {
  const fetchData = await getContractVerification({
    contractAddress: params.address,
  }).catch((e) => {
    return null
  })

  if (!fetchData) {
    return null
  }

  let parsedData: { metadata?: any; files: any[] } = {
    metadata: undefined,
    files: [],
  }
  if (fetchData && !fetchData?.error) {
    for (const file of fetchData) {
      if (file?.name === "metadata.json") {
        if (file?.content) {
          file.content = JSON.parse(file.content)
        }
        parsedData["metadata"] = file
      } else {
        parsedData["files"].push(file)
      }
    }
  }
  return parsedData
}

export default async function Page({ params, searchParams }) {
  const data = await getData({ params, searchParams })

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <p>Are you the contract creator? </p>
        <p>
          <Link
            href="https://sourcify.dev/"
            target="_blank"
            className="font-semibold"
          >
            Verify and Publish
          </Link>{" "}
          your contract source code today!
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground">
        Contract Source Code Verified (Exact Match)
      </p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CardDetail.Wrapper>
          <CardDetail.Title>Contract Name</CardDetail.Title>
          <CardDetail.Content>
            {data?.metadata?.content?.settings?.compilationTarget?.[
              Object.keys(
                data?.metadata?.content?.settings?.compilationTarget
              )?.[0]
            ]
              ? data?.metadata?.content?.settings?.compilationTarget?.[
                  Object.keys(
                    data?.metadata?.content?.settings?.compilationTarget
                  )?.[0]
                ]
              : "-"}
          </CardDetail.Content>
        </CardDetail.Wrapper>
        <CardDetail.Wrapper>
          <CardDetail.Title>Compiler Version</CardDetail.Title>
          <CardDetail.Content>
            {data?.metadata?.content?.compiler?.version}
          </CardDetail.Content>
        </CardDetail.Wrapper>
        <CardDetail.Wrapper>
          <CardDetail.Title>Optimization Enabled</CardDetail.Title>
          <CardDetail.Content>
            {data?.metadata?.settings?.optimizer?.enabled
              ? `Yes with ${
                  data?.metadata?.settings?.optimizer?.runs || "0"
                } runs`
              : "Disabled"}
          </CardDetail.Content>
        </CardDetail.Wrapper>
        <CardDetail.Wrapper>
          <CardDetail.Title>Other Settings</CardDetail.Title>
          <CardDetail.Content>default evmVersion</CardDetail.Content>
        </CardDetail.Wrapper>
      </div>
      <div className="flex flex-col gap-6">
        {data?.files?.map((item, _) => (
          <CodeEditor
            fileName={`File ${_ + 1} of ${data?.files?.length} - ${item?.name}`}
            key={_}
            value={item?.content}
          />
        ))}
      </div>

      <CodeEditor
        fileName={"ABI"}
        value={
          data?.metadata?.content?.output?.abi
            ? JSON.stringify(data?.metadata?.content?.output?.abi, null, 4)
            : ""
        }
      />

      {/* <div></div> */}
      {/* ABI */}
      {/* <div></div> */}
      {/* Contract Creation Code */}
      {/* <div></div> */}
      {/* Deployed Bytecode */}
      {/* <div></div> */}
      {/* Contructor Arguments */}
      {/* <div></div> */}
    </div>
  )
}