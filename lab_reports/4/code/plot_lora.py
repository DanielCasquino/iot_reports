#!/usr/bin/env python3
"""Offline LoRa plot. Accept numeric or original CSV; export numeric fields only."""
import argparse
import csv
import hashlib
import json
import math
import os
import statistics
import tempfile
from pathlib import Path


def read_numeric(path):
    rows = []
    with path.open(newline='', encoding='utf-8-sig') as stream:
        reader = csv.DictReader(stream)
        fields = ('t_s', 'rssi_dbm', 'snr_db')
        if not set(fields).issubset(reader.fieldnames or []):
            raise ValueError('CSV requires t_s, rssi_dbm and snr_db columns')
        for number, row in enumerate(reader, start=2):
            values = tuple(float(row[name]) for name in fields)
            if not all(math.isfinite(value) for value in values):
                raise ValueError(f'Non-finite numeric value at row {number}')
            if rows and values[0] < rows[-1][0]:
                raise ValueError(f'Time decreases at row {number}; no automatic sorting')
            rows.append(values)
    if not rows:
        raise ValueError('CSV contains no samples')
    first = rows[0][0]
    return [(round(t-first, 9), rssi, snr) for t, rssi, snr in rows]


def summarize(rows):
    return {
        'samples': len(rows), 'duration_s': rows[-1][0],
        'time_origin': 'first received sample',
        'rssi_dbm': {'min': min(x[1] for x in rows), 'max': max(x[1] for x in rows),
                     'mean': statistics.mean(x[1] for x in rows)},
        'snr_db': {'min': min(x[2] for x in rows), 'max': max(x[2] for x in rows),
                   'mean': statistics.mean(x[2] for x in rows)},
        'processing': 'all samples preserved in input order; no smoothing or interpolation',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path)
    parser.add_argument('--out-dir', type=Path, required=True)
    args = parser.parse_args()
    rows = read_numeric(args.csv)
    summary = summarize(rows)
    outputs = ['lora-numeric.csv', 'metrics.json', 'metrics.tex',
               'lora-rssi-snr.png', 'lora-rssi-snr.svg', 'lora-rssi-snr.pdf']
    args.out_dir.mkdir(parents=True, exist_ok=True)
    if any((args.out_dir / name).exists() for name in outputs):
        raise SystemExit('Refusing to overwrite an existing output')
    # Temporary matplotlib config avoids machine/user paths in reusable code.
    with tempfile.TemporaryDirectory(prefix='lora-plot-') as cache:
        os.environ['MPLCONFIGDIR'] = cache
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        matplotlib.rcParams['svg.hashsalt'] = 'lora-temporal-v1'
        with (args.out_dir/'lora-numeric.csv').open('x', newline='') as stream:
            writer = csv.writer(stream)
            writer.writerow(('t_s', 'rssi_dbm', 'snr_db'))
            writer.writerows((f'{t:.9f}', f'{rssi:g}', f'{snr:g}') for t,rssi,snr in rows)
        summary['numeric_csv_sha256'] = hashlib.sha256(
            (args.out_dir/'lora-numeric.csv').read_bytes()).hexdigest()
        with (args.out_dir/'metrics.json').open('x') as stream:
            json.dump(summary, stream, indent=2); stream.write('\n')
        rssi, snr = summary['rssi_dbm'], summary['snr_db']
        table = (
            '\\begin{table}[htbp]\\centering\n'
            '\\caption{Descriptive statistics of the received-sample record.}\n'
            '\\begin{tabular}{lr}\\hline\n'
            f'Received samples & {len(rows)} \\\\\n'
            f'Duration (s) & {summary["duration_s"]:.3f} \\\\\n'
            f'RSSI min/max (dBm) & {rssi["min"]:g} / {rssi["max"]:g} \\\\\n'
            f'Mean RSSI reading (dBm) & {rssi["mean"]:.2f} \\\\\n'
            f'SNR min/max (dB) & {snr["min"]:g} / {snr["max"]:g} \\\\\n'
            f'Mean SNR reading (dB) & {snr["mean"]:.2f} \\\\\n'
            '\\hline\\end{tabular}\\label{tab:metrics}\\end{table}\n')
        with (args.out_dir/'metrics.tex').open('x') as stream: stream.write(table)
        fig, axes = plt.subplots(2, 1, sharex=True, figsize=(6, 4.8), layout='constrained')
        for axis, column, label, color in (
            (axes[0],1,'RSSI [dBm]','#1767a0'),(axes[1],2,'SNR [dB]','#a34d00')):
            axis.plot([r[0] for r in rows], [r[column] for r in rows],
                      marker='o', markersize=3, linestyle='None', color=color)
            axis.set_ylabel(label); axis.grid(True, alpha=0.3)
            axis.margins(x=0.02)
        axes[0].set_title(f'LoRa receiver: {len(rows)} observed samples')
        axes[1].set_xlabel('Time after first received sample [s]')
        for extension in ('png','svg','pdf'):
            metadata = {'Date': None} if extension=='svg' else (
                {'CreationDate':None,'ModDate':None} if extension=='pdf' else {})
            fig.savefig(args.out_dir/f'lora-rssi-snr.{extension}', dpi=220, metadata=metadata)
        plt.close(fig)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
