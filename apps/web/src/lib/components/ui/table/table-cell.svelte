<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLTdAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLTdAttributes> = $props();
</script>

<td bind:this={ref} class={cn("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)} data-slot="table-cell" {...restProps}>
	{@render children?.()}
</td>
