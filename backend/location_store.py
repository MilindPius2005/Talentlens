"""Canonical location names shared by employee and job writes."""


def normalize_location(value):
    name = str(value or '').strip()
    return 'Bengaluru' if name.casefold() in ('bangalore', 'banglore', 'bengaluru') else name


def normalize_locations(values):
    if isinstance(values, str):
        values = [values]
    return list(dict.fromkeys(name for value in (values or []) if (name := normalize_location(value))))
