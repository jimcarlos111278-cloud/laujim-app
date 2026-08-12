package com.laujim.aptmanager;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.Calendar;
import java.util.TimeZone;

public class ScraperWorkerScheduleTest {
    private static final TimeZone BOGOTA = TimeZone.getTimeZone("America/Bogota");

    @Test
    public void hourlyScheduleAlignsToTopOfHour() {
        long now = localTime(2026, Calendar.AUGUST, 12, 15, 34, 20);
        long expected = localTime(2026, Calendar.AUGUST, 12, 16, 0, 0);
        assertEquals(expected, ScraperWorkerSchedule.calculateNextRunAt(now, 1, "07:00", "America/Bogota"));
    }

    @Test
    public void twelveHourScheduleUsesSevenAndNineteen() {
        long morning = localTime(2026, Calendar.AUGUST, 12, 15, 34, 20);
        long night = localTime(2026, Calendar.AUGUST, 12, 19, 0, 0);
        assertEquals(night, ScraperWorkerSchedule.calculateNextRunAt(morning, 12, "07:00", "America/Bogota"));

        long afterMidnight = localTime(2026, Calendar.AUGUST, 13, 2, 0, 0);
        long nextMorning = localTime(2026, Calendar.AUGUST, 13, 7, 0, 0);
        assertEquals(nextMorning, ScraperWorkerSchedule.calculateNextRunAt(afterMidnight, 12, "07:00", "America/Bogota"));
    }

    @Test
    public void scheduleContinuesAcrossMidnightWithoutDrift() {
        long now = localTime(2026, Calendar.AUGUST, 13, 2, 0, 0);
        long expected = localTime(2026, Calendar.AUGUST, 13, 3, 0, 0);
        assertEquals(expected, ScraperWorkerSchedule.calculateNextRunAt(now, 5, "07:00", "America/Bogota"));
    }

    @Test
    public void delayedWorkManagerWakeUsesSameHourlySlot() {
        long exactAlarm = localTime(2026, Calendar.AUGUST, 12, 16, 0, 0);
        long delayedBackup = localTime(2026, Calendar.AUGUST, 12, 16, 43, 0);
        assertEquals(
            ScraperWorkerSchedule.calculateCurrentSlotAt(exactAlarm, 1, "07:00", "America/Bogota"),
            ScraperWorkerSchedule.calculateCurrentSlotAt(delayedBackup, 1, "07:00", "America/Bogota")
        );
    }

    private static long localTime(int year, int month, int day, int hour, int minute, int second) {
        Calendar value = Calendar.getInstance(BOGOTA);
        value.clear();
        value.set(year, month, day, hour, minute, second);
        return value.getTimeInMillis();
    }
}
