"use client"

import * as React from "react"
import { Calendar as CalendarIcon, Clock } from "lucide-react"
import { format, isSameDay, setHours, setMinutes, getHours, getMinutes, startOfToday } from "date-fns"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"

interface DateTimePickerProps {
    date: Date | undefined;
    setDate: (date: Date | undefined) => void;
    minDate?: Date;
}

export function DateTimePicker({ date, setDate, minDate }: DateTimePickerProps) {
    const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(date);
    
    // Initialize time if date is set
    const defaultDate = new Date();
    const [hour, setHour] = React.useState<string>(date ? (getHours(date) % 12 || 12).toString() : (getHours(defaultDate) % 12 || 12).toString());
    const [minute, setMinute] = React.useState<string>(date ? getMinutes(date).toString() : getMinutes(defaultDate).toString());
    const [ampm, setAmpm] = React.useState<"AM" | "PM">(date ? (getHours(date) >= 12 ? "PM" : "AM") : (getHours(defaultDate) >= 12 ? "PM" : "AM"));

    React.useEffect(() => {
        if (date) {
            setSelectedDate(date);
            setHour((getHours(date) % 12 || 12).toString());
            setMinute(getMinutes(date).toString());
            setAmpm(getHours(date) >= 12 ? "PM" : "AM");
        }
    }, [date]);

    // Update parent when any part changes
    const updateDate = (d: Date | undefined, h: string, m: string, ap: "AM" | "PM") => {
        if (!d) {
            setDate(undefined);
            return;
        }

        let newHour = parseInt(h);
        const newMinute = parseInt(m);

        if (ap === "PM" && newHour !== 12) newHour += 12;
        if (ap === "AM" && newHour === 12) newHour = 0;

        const newDate = setHours(setMinutes(d, newMinute), newHour);
        setDate(newDate);
    };

    const handleDateSelect = (d: Date | undefined) => {
        setSelectedDate(d);
        if (d) {
            updateDate(d, hour, minute, ampm);
        } else {
            setDate(undefined);
        }
    };

    const handleTimeChange = (type: "hour" | "minute" | "ampm", value: string) => {
        if (type === "hour") setHour(value);
        if (type === "minute") setMinute(value);
        if (type === "ampm") setAmpm(value as "AM" | "PM");

        if (selectedDate) {
            updateDate(selectedDate, 
                type === "hour" ? value : hour, 
                type === "minute" ? value : minute, 
                type === "ampm" ? value as "AM" | "PM" : ampm
            );
        }
    };

    // Filter disabled times if today is selected
    const isTodaySelected = selectedDate && minDate && isSameDay(selectedDate, minDate);
    const currentHour = minDate ? getHours(minDate) : 0;
    const currentMinute = minDate ? getMinutes(minDate) : 0;

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant={"outline"}
                    className={cn(
                        "w-auto justify-start text-left font-normal",
                        !date && "text-muted-foreground"
                    )}
                >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP p") : <span>Pick a date</span>}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={handleDateSelect}
                    disabled={(date) => minDate ? date < startOfToday() : false}
                    initialFocus
                />
                <div className="p-3 border-t bg-gray-50 space-y-2">
                    <Label className="text-xs font-semibold text-muted-foreground">Time</Label>
                    <div className="flex items-center gap-2">
                        <Select value={hour} onValueChange={(v) => handleTimeChange("hour", v)}>
                            <SelectTrigger className="w-[70px]">
                                <SelectValue placeholder="Hour" />
                            </SelectTrigger>
                            <SelectContent position="popper" className="h-[200px]">
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                                    <SelectItem key={h} value={h.toString()}>{h.toString().padStart(2, '0')}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-muted-foreground">:</span>
                        <Select value={minute} onValueChange={(v) => handleTimeChange("minute", v)}>
                            <SelectTrigger className="w-[70px]">
                                <SelectValue placeholder="Min" />
                            </SelectTrigger>
                            <SelectContent position="popper" className="h-[200px]">
                                {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                                    <SelectItem key={m} value={m.toString()}>{m.toString().padStart(2, '0')}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={ampm} onValueChange={(v) => handleTimeChange("ampm", v)}>
                            <SelectTrigger className="w-[70px]">
                                <SelectValue placeholder="AM/PM" />
                            </SelectTrigger>
                            <SelectContent position="popper">
                                <SelectItem value="AM" disabled={isTodaySelected && currentHour >= 12}>AM</SelectItem>
                                <SelectItem value="PM">PM</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
