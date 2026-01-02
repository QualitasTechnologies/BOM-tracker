import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface VendorOption {
  id: string;
  company: string;
  leadTime: string;
  type: 'OEM' | 'Dealer';
  status: 'active' | 'inactive';
}

interface SearchableVendorSelectProps {
  vendors: VendorOption[];
  value?: string; // vendor company name
  onValueChange: (value: string | undefined) => void;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
}

export function SearchableVendorSelect({
  vendors,
  value,
  onValueChange,
  placeholder = "Select vendor...",
  className,
  triggerClassName,
  disabled = false,
}: SearchableVendorSelectProps) {
  const [open, setOpen] = React.useState(false);

  // Filter to active vendors and sort: OEM first, then alphabetically
  const sortedVendors = React.useMemo(() => {
    return vendors
      .filter((v) => v.status === "active")
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "OEM" ? -1 : 1;
        return a.company.localeCompare(b.company);
      });
  }, [vendors]);

  const selectedVendor = sortedVendors.find((v) => v.company === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "justify-between font-normal",
            !value && "text-muted-foreground",
            triggerClassName
          )}
        >
          {selectedVendor ? (
            <span className="flex items-center gap-2 truncate">
              <span
                className={cn(
                  "px-1 py-0.5 rounded text-[10px] flex-shrink-0",
                  selectedVendor.type === "OEM"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-green-100 text-green-700"
                )}
              >
                {selectedVendor.type}
              </span>
              <span className="truncate">{selectedVendor.company}</span>
            </span>
          ) : (
            placeholder
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("p-0", className)} align="start">
        <Command>
          <CommandInput placeholder="Search vendors..." />
          <CommandList>
            <CommandEmpty>No vendor found.</CommandEmpty>
            <CommandGroup>
              {/* Option to clear selection */}
              <CommandItem
                value="__NONE__"
                onSelect={() => {
                  onValueChange(undefined);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    !value ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="text-muted-foreground">No vendor selected</span>
              </CommandItem>

              {/* OEM vendors */}
              {sortedVendors.filter((v) => v.type === "OEM").length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                    OEM
                  </div>
                  {sortedVendors
                    .filter((v) => v.type === "OEM")
                    .map((vendor) => (
                      <CommandItem
                        key={vendor.id}
                        value={vendor.company}
                        onSelect={() => {
                          onValueChange(vendor.company);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value === vendor.company ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="flex items-center gap-2 flex-1 min-w-0">
                          <span
                            className="px-1 py-0.5 rounded text-[10px] bg-blue-100 text-blue-700 flex-shrink-0"
                          >
                            OEM
                          </span>
                          <span className="truncate">{vendor.company}</span>
                          {vendor.leadTime && (
                            <span className="text-muted-foreground text-xs flex-shrink-0">
                              ({vendor.leadTime})
                            </span>
                          )}
                        </span>
                      </CommandItem>
                    ))}
                </>
              )}

              {/* Dealer vendors */}
              {sortedVendors.filter((v) => v.type === "Dealer").length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                    Dealers
                  </div>
                  {sortedVendors
                    .filter((v) => v.type === "Dealer")
                    .map((vendor) => (
                      <CommandItem
                        key={vendor.id}
                        value={vendor.company}
                        onSelect={() => {
                          onValueChange(vendor.company);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value === vendor.company ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="flex items-center gap-2 flex-1 min-w-0">
                          <span
                            className="px-1 py-0.5 rounded text-[10px] bg-green-100 text-green-700 flex-shrink-0"
                          >
                            Dealer
                          </span>
                          <span className="truncate">{vendor.company}</span>
                          {vendor.leadTime && (
                            <span className="text-muted-foreground text-xs flex-shrink-0">
                              ({vendor.leadTime})
                            </span>
                          )}
                        </span>
                      </CommandItem>
                    ))}
                </>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
