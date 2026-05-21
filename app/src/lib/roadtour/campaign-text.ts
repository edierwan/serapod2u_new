const ALPHABETIC_CHARACTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/

export function toTitleCase(value: string): string {
    if (!value) return ''

    return value.replace(/\S+/g, (word) => {
        const firstAlphabeticIndex = word.search(ALPHABETIC_CHARACTER)
        if (firstAlphabeticIndex === -1) return word

        const prefix = word.slice(0, firstAlphabeticIndex)
        const alphaSegment = word.slice(firstAlphabeticIndex)
        return `${prefix}${alphaSegment.charAt(0).toUpperCase()}${alphaSegment.slice(1).toLowerCase()}`
    })
}

export function capitalizeFirstOnly(value: string): string {
    if (!value) return ''

    const firstNonSpaceIndex = value.search(/\S/)
    if (firstNonSpaceIndex === -1) return value

    return `${value.slice(0, firstNonSpaceIndex)}${value.charAt(firstNonSpaceIndex).toUpperCase()}${value.slice(firstNonSpaceIndex + 1)}`
}