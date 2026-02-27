
export const uniqueDocID = ({ docType }: { docType: string }) => {
    let dType = docType.toUpperCase()
    dType = dType.slice(0, 4)
    let tId = ((new Date()).getTime() - 1483200000000).toString(36).toUpperCase();
    return dType + '-' + tId
}